import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { AuthGate } from './auth/AuthGate'
import { SignInRoute } from './auth/SignInRoute'
import { MembersPage } from './pages/members/MembersPage'
import { CustomersPage } from './pages/insights/CustomersPage'
import { CaseStudiesPage } from './pages/insights/CaseStudiesPage'
import { InsightThemesPage } from './pages/insights/InsightThemesPage'
import { PlatformJourneyPage } from './pages/insights/PlatformJourneyPage'
import { DesignPage } from './pages/design/DesignPage'
import { MeasurePage } from './pages/measure/MeasurePage'
import { StoriesPage } from './pages/stories/StoriesPage'
import { Placeholder } from './pages/Placeholder'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { TaskListPage } from './pages/project/TaskListPage'
import { RequirementsEntryPage } from './pages/requirements/RequirementsEntryPage'
import { WriterPage } from './pages/requirements/WriterPage'
import { JourneyPage } from './pages/themes/JourneyPage'
import { PrioritiesPage } from './pages/themes/PrioritiesPage'
import { ThemesPage } from './pages/themes/ThemesPage'
import { TestPlanPage } from './pages/project/TestPlanPage'
import { TranscriptsPage } from './pages/transcripts/TranscriptsPage'
import { NewTestPlanPage } from './pages/testplan/NewTestPlanPage'

// Routes follow the prototype's handoff. Each placeholder is replaced by a real screen in its slice.
export function App() {
  return (
    <AuthGate>
    <Routes>
      <Route path="sign-in" element={<SignInRoute />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/insights/themes" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<NewTestPlanPage />} />
        <Route path="projects/:projectId/plan" element={<TestPlanPage />} />
        <Route path="projects/:projectId/tasks" element={<TaskListPage />} />
        <Route path="projects/:projectId/transcripts" element={<TranscriptsPage />} />
        <Route path="projects/:projectId/themes" element={<ThemesPage />} />
        <Route path="projects/:projectId/journey" element={<JourneyPage />} />
        <Route path="projects/:projectId/prio" element={<PrioritiesPage />} />
        <Route path="projects/:projectId/requirements" element={<RequirementsEntryPage />} />
        <Route path="projects/:projectId/requirements/:specId" element={<WriterPage />} />
        <Route path="requirements/:specId" element={<WriterPage />} />
        <Route path="projects/:projectId/design" element={<DesignPage />} />
        <Route path="projects/:projectId/stories" element={<StoriesPage />} />
        <Route path="projects/:projectId/measure" element={<MeasurePage />} />
        <Route path="projects/:projectId/:section" element={<Placeholder />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="insights/themes" element={<InsightThemesPage />} />
        <Route path="insights/personas" element={<CustomersPage />} />
        <Route path="insights/customers" element={<Navigate to="/insights/personas" replace />} />
        <Route path="insights/case-studies" element={<CaseStudiesPage />} />
        <Route path="insights/journey" element={<PlatformJourneyPage />} />
        <Route path="insights/onboarding" element={<Navigate to="/insights/journey" replace />} />
        <Route path="insights/:section" element={<Placeholder />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
    </AuthGate>
  )
}
