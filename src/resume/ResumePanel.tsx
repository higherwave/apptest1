import { ArrowRight } from '@carbon/icons-react'
import { useMemo, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProjects } from '../api/hooks'
import type { Project } from '../api/client'
import { STEPS } from '../shell/nav'
import { ago, readRecent, type Recent } from './recent'
import { nextTodo } from './todo'
import styles from './ResumePanel.module.scss'

// The task view at the top of Platform Insights: where you were (one click back to the page you left), and what is still open
// across the projects. "Where you were" is remembered in this browser; "what is left" is read from each project's own figures.
export function ResumePanel() {
  const projects = useProjects()
  const navigate = useNavigate()
  const recents = useMemo(() => readRecent(), [])
  const list = projects.data ?? []
  const byId = new Map(list.map((p) => [p.id, p]))
  const seen = recents.filter((r) => byId.has(r.projectId))
  const todos = list.map(nextTodo).filter((t) => t !== null)
  todos.sort((a, b) => Number(b.urgent) - Number(a.urgent))
  if (!list.length) return null

  const go = (to: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  const last: { project: Project; path: string; where: string; when: string | null } = seen[0]
    ? { project: byId.get(seen[0].projectId)!, path: seen[0].path, where: stepLabel(seen[0].step), when: ago(seen[0].at) }
    : { project: list[0], path: `/projects/${list[0].id}/${list[0].status === 'analyzed' ? 'themes' : 'plan'}`, where: list[0].status === 'analyzed' ? 'Themes' : 'Test Plan', when: null }
  const others: Recent[] = seen.slice(1, 4)

  return (
    <section className={styles.panel} aria-labelledby="resume-heading" data-testid="resume-panel" data-tour="resume">
      <div className={styles.left}>
        <h2 id="resume-heading" className={styles.label}>{when(last.when)}</h2>
        <p className={styles.project}>{last.project.name}</p>
        <p className={styles.where}>{last.when ? `You were on ${last.where}` : `Start at ${last.where}`}</p>
        <Link to={last.path} className={styles.continue} data-testid="resume-continue" onClick={go(last.path)}>
          Continue <ArrowRight size={16} aria-hidden />
        </Link>
        {others.length > 0 && (
          <ul className={styles.others} aria-label="Other recent projects">
            {others.map((r) => (
              <li key={r.projectId}>
                <Link to={r.path} className={styles.other} data-testid={`resume-${r.projectId}`} onClick={go(r.path)}>
                  <span>{byId.get(r.projectId)!.name}</span>
                  <span className={styles.meta}>{stepLabel(r.step)} · {ago(r.at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.right}>
        <h2 className={styles.label}>What is left to do</h2>
        {todos.length === 0 ? (
          <p className={styles.done} role="status">All caught up: every project is analyzed and measured.</p>
        ) : (
          <ul className={styles.todos}>
            {todos.slice(0, 4).map((t) => (
              <li key={t.project.id} className={styles.todo} data-urgent={t.urgent}>
                <span className={styles.dot} aria-hidden />
                <span className={styles.text}>
                  <span className={styles.name}>{t.project.name}</span>
                  <span>{t.text}</span>
                </span>
                <Link to={t.path} className={styles.open} data-testid={`todo-${t.project.id}`} onClick={go(t.path)} aria-label={`${t.text}: ${t.project.name}`}>
                  Open <ArrowRight size={16} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// The project step's name (the Platform Insights tab of the same key has a different one).
const stepLabel = (key: string) => STEPS.find((s) => s.key === key)?.label ?? key

const when = (w: string | null) => (w ? 'Pick up where you left off' : 'Start here')
