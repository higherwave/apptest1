import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { TourProvider } from './tour/TourProvider'
import { AuthGate } from './auth/AuthGate'
import { SignInRoute } from './auth/SignInRoute'
import { AreasPage } from './pages/areas/AreasPage'
import { TeamsPage } from './pages/teams/TeamsPage'
import { MembersPage } from './pages/members/MembersPage'
import { AppStatusPage } from './pages/settings/AppStatusPage'
import { AuditLogPage } from './pages/settings/AuditLogPage'
import { NotificationsPage } from './pages/settings/NotificationsPage'
import { UsagePage } from './pages/settings/UsagePage'
import { SettingsGate } from './pages/settings/SettingsGate'
import { CustomersPage } from './pages/insights/CustomersPage'
import { CaseStudiesPage } from './pages/insights/CaseStudiesPage'
import { InsightThemesPage } from './pages/insights/InsightThemesPage'
import { PlatformJourneyPage } from './pages/insights/PlatformJourneyPage'
import { DesignPage } from './pages/design/DesignPage'
import { MeasurePage } from './pages/measure/MeasurePage'
import { StoriesPage } from './pages/stories/StoriesPage'
import { Placeholder } from './pages/Placeholder'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { ParticipantsPage } from './pages/project/ParticipantsPage'
import { RequirementsEntryPage } from './pages/requirements/RequirementsEntryPage'
import { WriterPage } from './pages/requirements/WriterPage'
import { StoryboardPage } from './pages/storyboard/StoryboardPage'
import { PrioritiesPage } from './pages/themes/PrioritiesPage'
import { ThemesPage } from './pages/themes/ThemesPage'
import { TestPlanTabsPage } from './pages/project/TestPlanTabsPage'
import { TranscriptsPage } from './pages/transcripts/TranscriptsPage'
import { NewTestPlanPage } from './pages/testplan/NewTestPlanPage'

// Routes follow the prototype's handoff. Each placeholder is replaced by a real screen in its slice.
// The project step that used to be the Journey Map is the Storyboard; old addresses and bookmarks lead there.
function JourneyRedirect() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projects/${projectId}/storyboard`} replace />
}

// The Task List is now the Test Plan's second tab.
function TasksRedirect() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projects/${projectId}/plan/ask`} replace />
}

export function App() {
  return (
    <AuthGate>
    <Routes>
      <Route path="sign-in" element={<SignInRoute />} />
      <Route element={<TourProvider><AppShell /></TourProvider>}>
        <Route index element={<Navigate to="/insights/themes" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<NewTestPlanPage />} />
        <Route path="projects/:projectId/plan/*" element={<TestPlanTabsPage />} />
        <Route path="projects/:projectId/participants" element={<ParticipantsPage />} />
        <Route path="projects/:projectId/tasks" element={<TasksRedirect />} />
        <Route path="projects/:projectId/transcripts" element={<TranscriptsPage />} />
        <Route path="projects/:projectId/themes" element={<ThemesPage />} />
        <Route path="projects/:projectId/storyboard" element={<StoryboardPage />} />
        <Route path="projects/:projectId/journey" element={<JourneyRedirect />} />
        <Route path="projects/:projectId/prio" element={<PrioritiesPage />} />
        <Route path="projects/:projectId/requirements" element={<RequirementsEntryPage />} />
        <Route path="projects/:projectId/requirements/:specId" element={<WriterPage />} />
        <Route path="requirements/:specId" element={<WriterPage />} />
        <Route path="projects/:projectId/design" element={<DesignPage />} />
        <Route path="projects/:projectId/stories" element={<StoriesPage />} />
        <Route path="projects/:projectId/measure" element={<MeasurePage />} />
        <Route path="projects/:projectId/:section" element={<Placeholder />} />
        <Route path="members" element={<Navigate to="/settings/members" replace />} />
        <Route path="insights/themes" element={<InsightThemesPage />} />
        <Route path="insights/personas" element={<CustomersPage />} />
        <Route path="insights/customers" element={<Navigate to="/insights/personas" replace />} />
        <Route path="insights/case-studies" element={<CaseStudiesPage />} />
        <Route path="insights/journey" element={<PlatformJourneyPage />} />
        <Route path="insights/areas" element={<Navigate to="/settings/categories" replace />} />
        <Route path="settings" element={<SettingsGate />}>
          <Route index element={<Navigate to="/settings/categories" replace />} />
          <Route path="areas" element={<Navigate to="/settings/categories" replace />} />
          <Route path="categories" element={<AreasPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="status" element={<AppStatusPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="audit" element={<AuditLogPage />} />
        </Route>
        <Route path="insights/onboarding" element={<Navigate to="/insights/journey" replace />} />
        <Route path="insights/:section" element={<Placeholder />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
    </AuthGate>
  )
}
