import bump from '../lifecycles/bump.js'
import chalk from 'chalk'
import checkpoint from '../checkpoint.js'
import figures from 'figures'
import formatCommitMessage from '../format-commit-message.js'
import runExecFile from '../run-execFile.js'
import runLifecycleScript from '../run-lifecycle-script.js'
import { detectPMByLockFile } from '../detect-package-manager.js'

export default async function (newVersion, pkgPrivate, args) {
	await runLifecycleScript(args, 'pretag')
	await execTag(newVersion, pkgPrivate, args)
	await runLifecycleScript(args, 'posttag')
}

async function detectPublishHint() {
	const npmClientName = await detectPMByLockFile()
	const publishCommand = 'publish'
	return `${npmClientName} ${publishCommand}`
}

async function execTag(newVersion, pkgPrivate, args) {
	const tagOption = []
	if (args.sign) {
		tagOption.push('-s')
	}
	else {
		tagOption.push('-a')
	}
	if (args.tagForce) {
		tagOption.push('-f')
	}
	checkpoint(args, 'tagging release %s%s', [args.tagPrefix, newVersion])
	await runExecFile(args, 'git', [
		'tag',
		...tagOption,
		args.tagPrefix + newVersion,
		'-m',
		`${formatCommitMessage(args)}`,
	])
	const currentBranch = await runExecFile('', 'git', [
		'rev-parse',
		'--abbrev-ref',
		'HEAD',
	])
	let message = 'git push --follow-tags origin ' + currentBranch.trim()
	if (pkgPrivate !== true && bump.getUpdatedConfigs()['package.json']) {
		const npmPublishHint = args.npmPublishHint || (await detectPublishHint())
		message += ` && ${npmPublishHint}`
		if (args.prerelease !== undefined) {
			if (args.prerelease === '') {
				message += ' --tag prerelease'
			}
			else {
				message += ' --tag ' + args.prerelease
			}
		}
	}

	checkpoint(args, 'Run `%s` to publish', [message], chalk.blue(figures.info))
}