// What counts as the same experience category, and which area a question is about: the words, with no database and no model.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { similarAreas, stem, suggestAreas, tokens } from '../shared/areas.js'

const area = (name: string, definition: string | null = null, aliases: string[] = []) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, definition, aliases })
const AREAS = [
  area('Scheduling', 'Booking, moving and cancelling an appointment', ['Booking']),
  area('Reminders', 'Texts and emails that remind people of a visit'),
  area('Account setup', 'Creating an account, signing in, the profile'),
  area('Billing', 'Fees, insurance and payment'),
]

test('stems meet in the middle: Scheduling, Reschedule and Schedules are one word', () => {
  assert.equal(stem('Scheduling'), stem('Schedules'))
  assert.equal(stem('Reschedule'), stem('Scheduling'))
  assert.equal(stem('Reminders'), stem('Reminder'))
  assert.notEqual(stem('Billing'), stem('Scheduling'))
  assert.deepEqual(tokens('The Booking of an appointment').sort(), tokens('appointment booking').sort())
})

test('a new name is a duplicate of the same words, of an alias, or similar when it shares most of them', () => {
  const reason = (name: string) => similarAreas(name, AREAS).map((s) => [s.area.name, s.reason])
  assert.deepEqual(reason('scheduling'), [['Scheduling', 'same-name']])
  assert.deepEqual(reason('Schedule'), [['Scheduling', 'same-name']], 'a common ending does not make it new')
  assert.deepEqual(reason('Booking'), [['Scheduling', 'alias']])
  assert.deepEqual(reason('Rescheduling'), [['Scheduling', 'same-name']])
  assert.deepEqual(reason('Appointment scheduling'), [['Scheduling', 'similar']], 'one name inside the other')
  assert.deepEqual(reason('Reminder emails'), [['Reminders', 'similar']])
  assert.deepEqual(reason('Sign-in and account setup'), [['Account setup', 'similar']])
  assert.deepEqual(reason('Search'), [], 'nothing like it: a genuinely new area')
  assert.deepEqual(reason('Payments'), [], 'related, but not the same words: left to people')
})

test('a question is matched to the areas it is about, best first, and to none when it is about nothing known', () => {
  const top = (text: string) => suggestAreas(text, AREAS).map((s) => s.area.name)
  assert.deepEqual(top('Can you reschedule your appointment from the confirmation email?')[0], 'Scheduling')
  assert.deepEqual(top('What do you expect the reminder text to say?'), ['Reminders'])
  assert.equal(top('How would you create an account and sign in?')[0], 'Account setup')
  assert.deepEqual(top('How do you feel about the weather?'), [])
  assert.deepEqual(top(''), [])
  assert.ok(suggestAreas('booking cancelling moving appointment reminder', AREAS).length <= 3)
})

import { groupThemes, MIN_PARTICIPANTS } from './area-proposals.js'

const theme = (id: string, title: string, people: string[], projectId = 'p1') => ({ id, title, projectId, people })

test('proposals: a word shared by several themes and several people, that no area covers, becomes a suggested area', () => {
  const rows = [
    theme('1', 'Parking is hard to find at the clinic', ['a@p1', 'b@p1']),
    theme('2', 'Nowhere to park near the entrance', ['c@p1']),
    theme('3', 'Parking fees are confusing', ['a@p2'], 'p2'),
    theme('4', 'Forms are too long', ['a@p1', 'b@p1', 'c@p1']),
  ]
  const [first, ...rest] = groupThemes(rows, [])
  assert.equal(rest.length, 0, 'forms is one theme only')
  assert.equal(first.name, 'Parking')
  assert.deepEqual(first.themes.map((t) => t.id).sort(), ['1', '2', '3'], 'park and parking meet')
  assert.deepEqual([first.participants, first.projects], [4, 2])
  assert.ok(MIN_PARTICIPANTS >= 3)
})

test('proposals: too few people, an area that already covers it, or a dismissed word offers nothing', () => {
  const few = [theme('1', 'Parking is hard', ['a@p1']), theme('2', 'Parking fees', ['b@p1'])]
  assert.deepEqual(groupThemes(few, []), [], 'two people are not enough')
  const enough = [theme('1', 'Parking is hard', ['a@p1', 'b@p1']), theme('2', 'Parking fees', ['c@p1'])]
  assert.equal(groupThemes(enough, []).length, 1)
  assert.deepEqual(groupThemes(enough, [{ name: 'Parking', aliases: [] }]), [], 'an area has that name')
  assert.deepEqual(groupThemes(enough, [{ name: 'Getting there', aliases: ['Parking'] }]), [], 'or that other name')
  assert.deepEqual(groupThemes(enough, [], new Set([tokens('Parking')[0]])), [], 'dismissed')
})
