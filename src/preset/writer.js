import compareFunc from 'compare-func'
import { DEFAULT_COMMIT_TYPES } from './constants.js'
import { main, commit, header, footer } from './templates/index.js'

const COMMIT_HASH_LENGTH = 7
const releaseAsRegex = /release-as:\s*\w*@?([0-9]+\.[0-9]+\.[0-9a-z]+(-[0-9a-z.]+)?)\s*/i
/**
 * Handlebar partials for various property substitutions based on commit context.
 */
const owner = '{{#if this.owner}}{{~this.owner}}{{else}}{{~@root.owner}}{{/if}}'
const host = '{{~@root.host}}'
const repository = '{{#if this.repository}}{{~this.repository}}{{else}}{{~@root.repository}}{{/if}}'

export async function createWriterOpts(config) {
	const finalConfig = {
		types: DEFAULT_COMMIT_TYPES,
		issueUrlFormat: '{{host}}/{{owner}}/{{repository}}/issues/{{id}}',
		commitUrlFormat: '{{host}}/{{owner}}/{{repository}}/commit/{{hash}}',
		compareUrlFormat: '{{host}}/{{owner}}/{{repository}}/compare/{{previousTag}}...{{currentTag}}',
		userUrlFormat: '{{host}}/{{user}}',
		issuePrefixes: ['#'],
		...config,
	}
	const commitUrlFormat = expandTemplate(finalConfig.commitUrlFormat, {
		host,
		owner,
		repository,
	})
	const compareUrlFormat = expandTemplate(finalConfig.compareUrlFormat, {
		host,
		owner,
		repository,
	})
	const issueUrlFormat = expandTemplate(finalConfig.issueUrlFormat, {
		host,
		owner,
		repository,
		id: '{{this.issue}}',
		prefix: '{{this.prefix}}',
	})
	const writerOpts = getWriterOpts(finalConfig)

	writerOpts.mainTemplate = main
	writerOpts.headerPartial = header
		.replace(/{{compareUrlFormat}}/g, compareUrlFormat)
	writerOpts.commitPartial = commit
		.replace(/{{commitUrlFormat}}/g, commitUrlFormat)
		.replace(/{{issueUrlFormat}}/g, issueUrlFormat)
	writerOpts.footerPartial = footer
		.replace(/{{compareUrlFormat}}/g, compareUrlFormat)

	return writerOpts
}

function getWriterOpts(config) {
	const commitGroupOrder = config.types.flatMap(t => t.section).filter(t => t)

	return {
		finalizeContext: (context, _writerOpts, _filteredCommits, keyCommit) => {
			if (keyCommit) {
				const versionTagRegex = /tag:\s*([^,\s)]+)/i
				const keyCommitTag = keyCommit.gitTags?.match(versionTagRegex)
				if (keyCommitTag) {
					context.currentTag = keyCommitTag[1]
					const currentTagIndex = context.gitSemverTags.indexOf(context.currentTag)
					context.previousTag = (currentTagIndex === -1) ? null : context.gitSemverTags[currentTagIndex + 1]
				}
			}
			else {
				context.currentTag = context.newTag || null
				context.previousTag = context.gitSemverTags[0] || null
			}
			return context
		},
		transform: (commit, context) => {
			let discard = true
			const issues = []
			const entry = findTypeEntry(config.types, commit)

			// Add an entry in the CHANGELOG if special Release-As footer
			// is used:
			if ((commit.footer && releaseAsRegex.test(commit.footer))
				|| (commit.body && releaseAsRegex.test(commit.body))) {
				discard = false
			}

			const notes = commit.notes.map((note) => {
				discard = false

				return {
					...note,
					title: 'BREAKING CHANGES',
				}
			})

			// breaking changes attached to any type are still displayed.
			if (discard && (entry === undefined
				|| entry.hidden)) {
				return undefined
			}

			const type = entry
				? entry.section
				: commit.type
			const scope = commit.scope === '*'
				? ''
				: commit.scope
			const shortHash = typeof commit.hash === 'string'
				? commit.hash.substring(0, COMMIT_HASH_LENGTH)
				: commit.shortHash
			let { subject } = commit

			if (typeof subject === 'string') {
				// Issue URLs.
				const issueRegEx = `(${config.issuePrefixes.join('|')})([a-z0-9]+)`
				const re = new RegExp(issueRegEx, 'g')

				subject = subject.replace(re, (_, prefix, issue) => {
					issues.push(prefix + issue)

					const url = expandTemplate(config.issueUrlFormat, {
						host: context.host,
						owner: context.owner,
						repository: context.repository,
						id: issue,
						prefix,
					})

					return `[${prefix}${issue}](${url})`
				})
				// User URLs.
				subject = subject.replace(/\B@([a-z0-9](?:-?[a-z0-9/]){0,38})/g, (_, user) => {
					// TODO: investigate why this code exists.
					if (user.includes('/')) {
						return `@${user}`
					}

					const usernameUrl = expandTemplate(config.userUrlFormat, {
						host: context.host,
						owner: context.owner,
						repository: context.repository,
						user,
					})

					return `[@${user}](${usernameUrl})`
				})
			}

			// remove references that already appear in the subject
			const references = commit.references.filter(reference => !issues.includes(reference.prefix + reference.issue))

			return {
				notes,
				type,
				scope,
				shortHash,
				subject,
				references,
			}
		},
		groupBy: 'type',
		// the groupings of commit messages, e.g., Features vs., Bug Fixes, are
		// sorted based on their probable importance:
		commitGroupsSort: (a, b) => {
			const gRankA = commitGroupOrder.indexOf(a.title)
			const gRankB = commitGroupOrder.indexOf(b.title)

			return gRankA - gRankB
		},
		commitsSort: ['scope', 'subject'],
		noteGroupsSort: 'title',
		notesSort: compareFunc,
	}
}

function findTypeEntry(types, commit) {
	const typeKey = (commit.revert ? 'revert' : commit.type || '').toLowerCase()

	return types.find((entry) => {
		if (entry.type !== typeKey) {
			return false
		}

		if (entry.scope && entry.scope !== commit.scope) {
			return false
		}

		return true
	})
}

// expand on the simple mustache-style templates supported in
// configuration (we may eventually want to use handlebars for this).
function expandTemplate(template, context) {
	let expanded = template

	Object.keys(context).forEach((key) => {
		expanded = expanded.replace(new RegExp(`{{${key}}}`, 'g'), context[key])
	})
	return expanded
}