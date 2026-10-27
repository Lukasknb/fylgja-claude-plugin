import { describe, expect, test } from 'claude-code/testing'
import { repoNameOf } from '../hooks/scribe/repo'

describe('repoNameOf', () => {
  test('a GitHub remote is owner/name, in either spelling', () => {
    expect(repoNameOf('git@github.com:acme/web.git', '/x/web')).toBe('acme/web')
    expect(repoNameOf('https://github.com/acme/web', '/x/web')).toBe('acme/web')
  })

  test('a GitLab nested group is kept whole', () => {
    expect(repoNameOf('git@gitlab.com:group/sub/repo.git', '/x/repo')).toBe('group/sub/repo')
    expect(repoNameOf('https://gitlab.com/group/sub/repo.git', '/x/repo')).toBe('group/sub/repo')
  })

  test('every Azure DevOps form of one repository is org/project/repo', () => {
    for (const remote of [
      'https://dev.azure.com/contoso/payments/_git/ledger',
      'https://contoso@dev.azure.com/contoso/payments/_git/ledger',
      'git@ssh.dev.azure.com:v3/contoso/payments/ledger',
      'https://contoso.visualstudio.com/payments/_git/ledger',
      'contoso@vs-ssh.visualstudio.com:v3/contoso/payments/ledger',
    ]) {
      expect(repoNameOf(remote, '/x/ledger')).toBe('contoso/payments/ledger')
    }
  })

  test('with no git remote the folder is the name', () => {
    expect(repoNameOf(null, '/home/x/dev/web')).toBe('web')
    expect(repoNameOf('../web', '/home/x/dev/web')).toBe('web')
  })
})
