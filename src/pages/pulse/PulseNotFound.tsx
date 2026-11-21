import { PageHero } from '../../shell/PageHero'

// Anyone Pulse is not for sees the page that does not exist: the server answers 404 to them too.
export function PulseNotFound() {
  return (
    <div>
      <PageHero title="Page not found" description="There is nothing at this address." />
    </div>
  )
}
