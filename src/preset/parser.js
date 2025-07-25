export function createParserOpts(config) {
	return {
		headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
		breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
		headerCorrespondence: ['type', 'scope', 'subject'],
		noteKeywords: ['BREAKING CHANGE', 'BREAKING-CHANGE'],
		revertPattern: /^(?:Revert|revert:)\s"?([\s\S]+?)"?\s*This reverts commit (\w*)\./i,
		revertCorrespondence: ['header', 'hash'],
		issuePrefixes: config?.issuePrefixes || ['#'],
	}
}