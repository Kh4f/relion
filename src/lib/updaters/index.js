import path from 'path'
import defaults from '../../defaults.js'
import * as jsonUpdater from './types/json.js'
import * as plainTextUpdater from './types/plain-text.js'
import * as mavenUpdater from './types/maven.js'
import * as gradleUpdater from './types/gradle.js'
import * as csprojUpdater from './types/csproj.js'
import * as yamlUpdater from './types/yaml.js'
import * as openapiUpdater from './types/openapi.js'
import * as pythonUpdater from './types/python.js'

const JSON_BUMP_FILES = defaults.bumpFiles
const updatersByType = {
	'json': jsonUpdater,
	'plain-text': plainTextUpdater,
	'maven': mavenUpdater,
	'gradle': gradleUpdater,
	'csproj': csprojUpdater,
	'yaml': yamlUpdater,
	'openapi': openapiUpdater,
	'python': pythonUpdater,
}
const PLAIN_TEXT_BUMP_FILES = ['VERSION.txt', 'version.txt']

function getUpdaterByType(type) {
	const updater = updatersByType[type]
	if (!updater) {
		throw Error(`Unable to locate updater for provided type (${type}).`)
	}
	return updater
}

function getUpdaterByFilename(filename) {
	if (JSON_BUMP_FILES.includes(path.basename(filename))) {
		return getUpdaterByType('json')
	}
	if (PLAIN_TEXT_BUMP_FILES.includes(filename)) {
		return getUpdaterByType('plain-text')
	}
	if (/pom.xml/.test(filename)) {
		return getUpdaterByType('maven')
	}
	if (/build.gradle/.test(filename)) {
		return getUpdaterByType('gradle')
	}
	if (filename.endsWith('.csproj')) {
		return getUpdaterByType('csproj')
	}
	if (/openapi.yaml/.test(filename)) {
		return getUpdaterByType('openapi')
	}
	if (/\.ya?ml$/.test(filename)) {
		return getUpdaterByType('yaml')
	}
	if (/pyproject.toml/.test(filename)) {
		return getUpdaterByType('python')
	}
	throw Error(
		`Unsupported file (${filename}) provided for bumping.\n Please specify the updater \`type\` or use a custom \`updater\`.`,
	)
}

async function getCustomUpdaterFromPath(updater) {
	if (typeof updater === 'string') {
		return (await import(path.resolve(process.cwd(), updater))).default
	}
	if (
		typeof updater.readVersion === 'function'
		&& typeof updater.writeVersion === 'function'
	) {
		return updater
	}
	throw new Error('Updater must be a string path or an object with readVersion and writeVersion methods')
}

/**
 * Simple check to determine if the object provided is a compatible updater.
 */
function isValidUpdater(obj) {
	return (
		obj
		&& typeof obj.readVersion === 'function'
		&& typeof obj.writeVersion === 'function'
	)
}

export async function resolveUpdaterObjectFromArgument(arg) {
	/**
	 * If an Object was not provided, we assume it's the path/filename
	 * of the updater.
	 */
	let updater = arg
	if (isValidUpdater(updater)) {
		return updater
	}
	if (typeof updater !== 'object') {
		updater = {
			filename: arg,
		}
	}

	if (!isValidUpdater(updater.updater)) {
		try {
			if (typeof updater.updater === 'string') {
				updater.updater = await getCustomUpdaterFromPath(updater.updater)
			}
			else if (updater.type) {
				updater.updater = getUpdaterByType(updater.type)
			}
			else {
				updater.updater = getUpdaterByFilename(updater.filename)
			}
		}
		catch (err) {
			if (err.code !== 'ENOENT')
				console.warn(
					`Unable to obtain updater for: ${JSON.stringify(arg)}\n - Error: ${err.message
					}\n - Skipping...`,
				)
		}
	}
	/**
	 * We weren't able to resolve an updater for the argument.
	 */
	if (!isValidUpdater(updater.updater)) {
		return false
	}

	return updater
}