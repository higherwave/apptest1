// What counts as the same feature area, and which area a question is about: the words, with no database and no model.
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
