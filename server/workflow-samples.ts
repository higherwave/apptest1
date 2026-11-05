// The healthcare examples a workspace can start from (the "Add the healthcare examples" button on Platform Insights > Journey). Everything here is
// made up: the teams, systems and owners are what a clinic's blueprint could look like, not data about any real organisation. The first workflow's
// stages carry the same names as the demo clinic study's journey stages, so a project on that study maps to them by name.
import type { WorkflowInput } from './workflows.js'

type S = [name: string, good: string, signal: string, handoff: string, backstage: [kind: 'Team' | 'System' | 'Process', name: string, owner: string][]]
const build = (name: string, description: string, stages: S[]): WorkflowInput => ({
  name,
  description,
  stages: stages.map(([sName, good, signal, handoff, backstage]) => ({
    id: null, name: sName, good, signal, handoff,
    backstage: backstage.map(([kind, bName, owner]) => ({ id: null, kind, name: bName, owner })),
  })),
})

export const SAMPLE_WORKFLOWS: WorkflowInput[] = [
  build('Patient access and scheduling', 'How a patient finds a provider, books, pays, prepares and follows up.', [
    ['Find a provider', 'The patient finds a provider who takes their insurance and has openings, without calling.', 'Searches that end without a booking; calls asking who is in network.', 'The provider choice carries into booking with the visit type and insurance already known.', [
      ['Team', 'Provider data team', 'Provider Operations'], ['System', 'Provider directory and insurance network data', 'Platform Engineering'], ['Process', 'Quarterly insurance network verification', 'Revenue Cycle']]],
    ['Book a time', 'The patient sees real openings and books in one sitting.', 'Booking completion rate; slot-not-available errors; double bookings.', 'A confirmed slot is written to the clinic schedule and the patient record.', [
      ['Team', 'Scheduling team', 'Patient Access'], ['System', 'Booking and calendar system', 'Scheduling Platform'], ['System', 'Patient records (EHR)', 'Clinical Systems']]],
    ['Confirm & pay', 'The patient knows what they will owe before they arrive.', 'Surprise balances at the visit; eligibility check failures; billing calls after booking.', 'The eligibility result and the estimate attach to the appointment.', [
      ['Team', 'Billing and insurance team', 'Revenue Cycle'], ['System', 'Payments platform', 'Finance Systems'], ['Process', 'Insurance eligibility check', 'Revenue Cycle']]],
    ['Prepare or change', 'Reminders arrive in time to prepare, and a change is one step.', 'No-show rate; reschedules handled by phone; reminder bounces.', 'A reschedule releases the old slot and tells the care team.', [
      ['System', 'Messaging service', 'Patient Communications'], ['Team', 'Patient communications', 'Patient Access'], ['Process', 'Intake forms and pre-visit checklist', 'Front Desk']]],
    ['Visit & follow-up', 'Check-in is quick, and the follow-up plan is in the patient’s hands before they leave.', 'Wait at check-in; follow-up visits booked within the window.', 'Visit notes and the follow-up plan return to the patient record and the patient.', [
      ['Team', 'Front desk staff', 'Clinic Operations'], ['System', 'Patient records (EHR)', 'Clinical Systems'], ['Team', 'Care team', 'Clinical Operations']]],
  ]),
  build('Referrals and results', 'How a referral reaches a specialist and the outcome comes back to the patient and the referring clinic.', [
    ['Referral placed', 'The referral reaches the right specialist with the reason and the urgency.', 'Referrals with no response after three days.', 'The referral package goes to the specialist’s intake.', [
      ['Team', 'Referral coordinators', 'Care Coordination'], ['System', 'Referral management system', 'Clinical Systems'], ['Process', 'Referral triage', 'Care Coordination']]],
    ['Records shared', 'The relevant records arrive before the visit.', 'Visits that start without records.', 'The records are available in the specialist’s chart.', [
      ['System', 'Health information exchange', 'Integration Engineering'], ['Team', 'Medical records team', 'Health Information Management'], ['Process', 'Release of information consent', 'Compliance']]],
    ['Specialist booked', 'The patient has a confirmed specialist appointment within the target window.', 'Days from referral to appointment.', 'The appointment is confirmed to the patient and the referring clinic.', [
      ['Team', 'Specialty scheduling', 'Patient Access'], ['System', 'Booking and calendar system', 'Scheduling Platform']]],
    ['Specialist visit', 'The visit starts on time with the history in hand.', 'Late starts; patients asked to repeat their history.', 'A visit summary is written back to the referring clinic.', [
      ['Team', 'Specialist clinic staff', 'Specialty Clinics'], ['System', 'Patient records (EHR)', 'Clinical Systems']]],
    ['Results returned', 'The patient and the referring clinician both hear the outcome.', 'Results more than a week old with no patient contact.', 'The results and next steps reach the patient portal and the referring clinic.', [
      ['Team', 'Care team', 'Clinical Operations'], ['System', 'Patient portal', 'Digital Products'], ['Process', 'Results review and release', 'Clinical Operations']]],
  ]),
]
