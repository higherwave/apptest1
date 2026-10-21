import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { StoriesPage } from './pages/stories/StoriesPage'
import { Placeholder } from './pages/Placeholder'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { TaskListPage } from './pages/project/TaskListPage'
import { RequirementsListPage } from './pages/requirements/RequirementsListPage'
import { WriterPage } from './pages/requirements/WriterPage'
import { JourneyPage } from './pages/themes/JourneyPage'
import { PrioritiesPage } from './pages/themes/PrioritiesPage'
import { ThemesPage } from './pages/themes/ThemesPage'
import { TestPlanPage } from './pages/project/TestPlanPage'
import { TranscriptsPage } from './pages/transcripts/TranscriptsPage'
import { NewProjectPage } from './pages/wizard/NewProjectPage'

// Routes follow the prototype's handoff. Each placeholder is replaced by a real screen in its slice.
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<NewProjectPage />} />
        <Route path="projects/:projectId/plan" element={<TestPlanPage />} />
        <Route path="projects/:projectId/tasks" element={<TaskListPage />} />
        <Route path="projects/:projectId/transcripts" element={<TranscriptsPage />} />
        <Route path="projects/:projectId/themes" element={<ThemesPage />} />
        <Route path="projects/:projectId/journey" element={<JourneyPage />} />
        <Route path="projects/:projectId/prio" element={<PrioritiesPage />} />
        <Route path="projects/:projectId/requirements" element={<RequirementsListPage />} />
        <Route path="projects/:projectId/requirements/:specId" element={<WriterPage />} />
        <Route path="requirements/:specId" element={<WriterPage />} />
        <Route path="projects/:projectId/stories" element={<StoriesPage />} />
        <Route path="projects/:projectId/:section" element={<Placeholder />} />
        <Route path="insights/:section" element={<Placeholder />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  )
}
