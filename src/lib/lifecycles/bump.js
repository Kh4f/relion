import checkpoint from '../checkpoint.js'
import { Bumper } from 'conventional-recommended-bump'
import fs from 'fs'
import DotGitignore from 'dotgitignore'
import path from 'path'
import runLifecycleScript from '../run-lifecycle-script.js'
import semver from 'semver'
import writeFile from '../write-file.js'
import { resolveUpdaterObjectFromArgument } from '../updaters/index.js'
let configsToUpdate = {}
const sanitizeQuotesRegex = /['"]+/g

async function Bump(args, newVersion) {
	// reset the cache of updated config files each
	// time we perform the version bump step.
	configsToUpdate = {}

	if (
		args.releaseAs
		&& !(['major', 'minor', 'patch'].includes(args.releaseAs.toLowerCase()) || semver.valid(args.releaseAs))
	) {
		throw new Error('releaseAs must be one of \'major\', \'minor\' or \'patch\', or a valid semvar version.')
	}

	await runLifecycleScript(args, 'prerelease')
	const stdout = await runLifecycleScript(args, 'prebump')
	if (stdout?.trim().length) {
		const prebumpString = stdout.trim().replace(sanitizeQuotesRegex, '')
		if (semver.valid(prebumpString)) args.releaseAs = prebumpString
	}
	updateConfigs(args, newVersion)
	await runLifecycleScript(args, 'postbump')
	return newVersion
}

Bump.getUpdatedConfigs = function () {
	return configsToUpdate
}

/**
 * Get the new version number
 * @param args
 * @param version
 * @returns Promise<string>
 */
export async function getNewVersion(args, version) {
	let newVersion = version
	if (semver.valid(args.releaseAs)) {
		const releaseAs = new semver.SemVer(args.releaseAs)
		if (
			isString(args.prerelease)
			&& releaseAs.prerelease.length
			&& releaseAs.prerelease.slice(0, -1).join('.') !== args.prerelease
		) {
			// If both releaseAs and the prerelease identifier are supplied, they must match. The behavior
			// for a mismatch is undefined, so error out instead.
			throw new Error('releaseAs and prerelease have conflicting prerelease identifiers')
		}
		else if (isString(args.prerelease) && releaseAs.prerelease.length) {
			newVersion = releaseAs.version
		}
		else if (isString(args.prerelease)) {
			newVersion = `${releaseAs.major}.${releaseAs.minor}.${releaseAs.patch}-${args.prerelease}.0`
		}
		else {
			newVersion = releaseAs.version
		}

		// Check if the previous version is the same version and prerelease, and increment if so
		if (
			isString(args.prerelease)
			&& ['prerelease', null].includes(semver.diff(version, newVersion))
			&& semver.lte(newVersion, version)
		) {
			newVersion = semver.inc(version, 'prerelease', args.prerelease)
		}

		// Append any build info from releaseAs
		newVersion = semvarToVersionStr(newVersion, releaseAs.build)
	}
	else {
		const release = await bumpVersion(args.releaseAs, version, args)
		const releaseType = getReleaseType(args.prerelease, release.releaseType, version)

		newVersion = semver.inc(version, releaseType, args.prerelease)
	}
	return newVersion
}

/**
 * Convert a semver object to a full version string including build metadata
 * @param {string} semverVersion The semvar version string
 * @param {string[]} semverBuild An array of the build metadata elements, to be joined with '.'
 * @returns {string}
 */
function semvarToVersionStr(semverVersion, semverBuild) {
	return [semverVersion, semverBuild.join('.')].filter(Boolean).join('+')
}

function getReleaseType(prerelease, expectedReleaseType, currentVersion) {
	if (isString(prerelease)) {
		if (isInPrerelease(currentVersion)) {
			if (
				shouldContinuePrerelease(currentVersion, expectedReleaseType)
				|| getTypePriority(getCurrentActiveType(currentVersion)) > getTypePriority(expectedReleaseType)
			) {
				return 'prerelease'
			}
		}

		return 'pre' + expectedReleaseType
	}
	else {
		return expectedReleaseType
	}
}

function isString(val) {
	return typeof val === 'string'
}

/**
 * if a version is currently in pre-release state,
 * and if it current in-pre-release type is same as expect type,
 * it should continue the pre-release with the same type
 *
 * @param version
 * @param expectType
 * @return {boolean}
 */
function shouldContinuePrerelease(version, expectType) {
	return getCurrentActiveType(version) === expectType
}

function isInPrerelease(version) {
	return Array.isArray(semver.prerelease(version))
}

const TypeList = ['major', 'minor', 'patch'].reverse()

/**
 * extract the in-pre-release type in target version
 *
 * @param version
 * @return {string}
 */
function getCurrentActiveType(version) {
	const typelist = TypeList
	for (let i = 0; i < typelist.length; i++) {
		if (semver[typelist[i]](version)) {
			return typelist[i]
		}
	}
}

/**
 * calculate the priority of release type,
 * major - 2, minor - 1, patch - 0
 *
 * @param type
 * @return {number}
 */
function getTypePriority(type) {
	return TypeList.indexOf(type)
}

async function bumpVersion(releaseAs, currentVersion, args) {
	if (releaseAs) {
		return {
			releaseType: releaseAs,
		}
	}
	else {
		const recommendation = await getRecommendedBump(args, currentVersion)
		if (recommendation) {
			return recommendation
		}
		else {
			throw new Error('No recommendation found')
		}
	}
}

async function getRecommendedBump(args, currentVersion) {
	const bumper = new Bumper(args.path)
	bumper.loadPreset({
		preMajor: semver.lt(currentVersion, '1.0.0'),
		...args.preset,
	})
	bumper.tag({
		tagPrefix: args.tagPrefix,
		lernaPackage: args.lernaPackage,
	})
	bumper.commits({}, args.parserOpts)
	const recommendation = await bumper.bump()
	return recommendation
}

/**
 * attempt to update the version number in provided `bumpFiles`
 * @param args config object
 * @param newVersion version number to update to.
 * @return void
 */
function updateConfigs(args, newVersion) {
	const dotgit = DotGitignore()
	args.bumpFiles.forEach(async function (bumpFile) {
		const updater = await resolveUpdaterObjectFromArgument(bumpFile)
		if (!updater) {
			return
		}
		const configPath = path.resolve(process.cwd(), updater.filename)
		try {
			if (dotgit.ignore(updater.filename)) {
				console.debug(`Not updating file '${updater.filename}', as it is ignored in Git`)
				return
			}
			const stat = fs.lstatSync(configPath)

			if (!stat.isFile()) {
				console.debug(`Not updating '${updater.filename}', as it is not a file`)
				return
			}
			const contents = fs.readFileSync(configPath, 'utf8')
			const newContents = updater.updater.writeVersion(contents, newVersion)
			const realNewVersion = updater.updater.readVersion(newContents)
			checkpoint(args, 'bumping version in ' + updater.filename + ' from %s to %s', [
				updater.updater.readVersion(contents),
				realNewVersion,
			])
			writeFile(args, configPath, newContents)
			// flag any config files that we modify the version # for
			// as having been updated.
			configsToUpdate[updater.filename] = true
		}
		catch (err) {
			if (err.code !== 'ENOENT') console.warn(err.message)
		}
	})
}

export default Bump