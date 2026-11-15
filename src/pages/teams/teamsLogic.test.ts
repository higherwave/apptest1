import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addable, channelProblem, deleteBlock, nameProblem, normalizeChannel, teamChange } from './teamsLogic'

const team = { name: 'Growth', slackChannel: 'growth', members: [{ memberId: 'a', email: 'a@x', displayName: 'A', role: 'editor' as const }] }

test('a Slack channel is cleaned of a # and capitals, and must be a plain name', () => {
  assert.equal(normalizeChannel('  #Anchor-CX '), 'anchor-cx')
  assert.equal(channelProblem(''), null)
  assert.equal(channelProblem('#launches_2'), null)
  assert.match(channelProblem('no good!') ?? '', /lowercase letters/)
})

test('a team needs a name no other team has, whatever the case', () => {
  const teams = [{ id: '1', name: 'General' }, { id: '2', name: 'Growth' }]
  assert.equal(nameProblem('  ', teams), 'Enter a team name.')
  assert.equal(nameProblem('growth', teams), 'A team with that name already exists.')
  assert.equal(nameProblem('growth', teams, '2'), null, 'its own name is fine')
  assert.equal(nameProblem('Ops', teams), null)
})

test('a save sends only what changed', () => {
  const same = { name: 'Growth', channel: '#Growth', members: { a: 'editor' as const }, moves: {} }
  assert.equal(teamChange(team, same), null)
  assert.deepEqual(teamChange(team, { ...same, name: ' Growth team ' }), { name: 'Growth team' })
  assert.deepEqual(teamChange(team, { ...same, channel: '' }), { slackChannel: null })
  assert.deepEqual(teamChange(team, { ...same, members: { a: 'viewer' } }), { members: { a: 'viewer' } })
  assert.deepEqual(teamChange(team, { ...same, members: {} }), { members: {} })
  assert.deepEqual(teamChange(team, { ...same, moves: { p1: 't2', p2: '' } }), { moveProjects: { p1: 't2' } })
})

test('anyone in the workspace but external people and those already in the team can be added', () => {
  assert.deepEqual(addable([{ id: 'a', external: false }, { id: 'b', external: false }, { id: 'c', external: true }], { a: 'editor' }).map((m) => m.id), ['b'])
})

test('the default team and a team with projects cannot be deleted', () => {
  assert.match(deleteBlock({ isDefault: true, projects: [] }) ?? '', /default team/)
  assert.match(deleteBlock({ isDefault: false, projects: [{ id: 'p', name: 'P' }] }) ?? '', /Move this team’s projects/)
  assert.equal(deleteBlock({ isDefault: false, projects: [] }), null)
})
