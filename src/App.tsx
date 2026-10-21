import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './shell/AppShell'
import { Placeholder } from './pages/Placeholder'
import { ProjectsPage } from './pages/projects/ProjectsPage'
import { TaskListPage } from './pages/project/TaskListPage'
import { TestPlanPage } from './pages/project/TestPlanPage'
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
        <Route path="projects/:projectId/:section" element={<Placeholder />} />
        <Route path="insights/:section" element={<Placeholder />} />
        <Route path="*" element={<Placeholder title="Page not found" />} />
      </Route>
    </Routes>
  )
}
