import { useState } from 'react'
import { Button, InlineNotification, Tag } from '@carbon/react'
import { useConnections, useConnectJira, useConnectSlack, useDisconnect } from '../../api/hooks'
import { T } from '../../../shared/terms.mjs'
import { ConnectForm, DisconnectModal } from './ConnectionParts'
import styles from './PulseSources.module.scss'

// Settings, Apps: the workspace's own Slack and Jira. An owner pastes the secret here (a Slack bot token, or a Jira API token with the address, account email and project), the app tries it first and stores
// it encrypted, and it is never shown again. Where the home workspace uses the deployment's own settings, this says so and the owner can still give the workspace its own.
export function ConnectionsSection() {
  const conns = useConnections()
  const c = conns.data
  return (
    <>
      <SlackCard c={c?.slack} loaded={!!c} />
      <JiraCard c={c?.jira} loaded={!!c} />
    </>
  )
}

type Source = 'own' | 'deployment' | 'none'

function Status({ kind, connected, source, detail }: { kind: string; connected: boolean; source: Source; detail: string | null }) {
  return (
    <div className={styles.top}>
      <Tag size="sm" type={connected ? 'green' : 'gray'}>{connected ? 'Connected' : 'Not connected'}</Tag>
      {detail && <span className={styles.detail} data-testid={`${kind}-detail`}>{detail}</span>}
      {connected && source === 'deployment' && <span className={styles.detail}>Set by this deployment's own settings.</span>}
    </div>
  )
}

function SlackCard({ c, loaded }: { c?: { connected: boolean; source: Source }; loaded: boolean }) {
  const connect = useConnectSlack()
  const disconnect = useDisconnect()
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const connected = !!c?.connected
  const own = c?.source === 'own'
  const showForm = loaded && (!connected || replacing)
  return (
    <section className={styles.card} aria-label="Slack" data-testid="connect-slack-card">
      <h2 className={styles.head}>Slack</h2>
      <p className={styles.text}>
        {`Where this workspace's notifications, launch ${T.approvals} and reminders are posted, and where Pulse can read the feedback channels you choose. Connecting uses your own Slack app's bot token, so nothing posts into anyone else's Slack.`}
      </p>
      {loaded && <Status kind="slack" connected={connected} source={c?.source ?? 'none'} detail={null} />}
      {done && <InlineNotification hideCloseButton lowContrast kind="success" title="Slack is connected" subtitle={`Slack accepted the token${done === '-' ? '' : ` for ${done}`}. It is stored encrypted and is not shown again.`} data-testid="connected-slack" />}
      {connected && (
        <div className={styles.actions}>
          <Button kind="ghost" size="sm" data-testid="replace-slack" onClick={() => setReplacing((r) => !r)}>
            {replacing ? 'Cancel' : own ? 'Replace token' : 'Use its own Slack'}
          </Button>
          {own && (
            <Button kind="ghost" size="sm" data-testid="disconnect-slack" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      )}
      {showForm && (
        <ConnectForm
          kind="slack"
          intro={<>In your Slack app (api.slack.com/apps), open OAuth &amp; Permissions and copy the <b>Bot User OAuth Token</b>, which starts with xoxb-. It is tried against Slack first, then stored encrypted, and never shown again.</>}
          fields={[{ key: 'token', label: 'Slack bot token', secret: true, placeholder: 'xoxb-…' }]}
          submitLabel={replacing ? 'Replace token' : 'Connect Slack'}
          pending={connect.isPending}
          error={connect.isError ? connect.error : null}
          onSubmit={async (v) => {
            const r = await connect.mutateAsync({ token: v.token })
            setReplacing(false)
            setDone((r as { team?: string | null }).team ?? '-')
          }}
        />
      )}
      <DisconnectModal kind="slack" name="Slack" open={confirming} pending={disconnect.isPending} error={disconnect.isError ? disconnect.error : null} extra="Where this deployment has its own Slack, that applies again." onClose={() => setConfirming(false)} onConfirm={async () => { try { await disconnect.mutateAsync('slack'); setConfirming(false); setDone(null) } catch { /* shown */ } }} />
    </section>
  )
}

function JiraCard({ c, loaded }: { c?: { connected: boolean; source: Source; siteUrl: string | null; projectKey: string | null; email: string | null }; loaded: boolean }) {
  const connect = useConnectJira()
  const disconnect = useDisconnect()
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const connected = !!c?.connected
  const own = c?.source === 'own'
  const showForm = loaded && (!connected || replacing)
  const detail = c?.siteUrl ? `${c.siteUrl.replace(/^https:\/\//, '')} · project ${c.projectKey ?? ''}${c.email ? ` · ${c.email}` : ''}` : null
  return (
    <section className={styles.card} aria-label="Jira" data-testid="connect-jira-card">
      <h2 className={styles.head}>Jira</h2>
      <p className={styles.text}>
        Where "Create Jira ticket" on a story makes a real issue, in the project you choose. It uses a Jira API token from the account that should own the tickets. Without a connection, tickets are simulated.
      </p>
      {loaded && <Status kind="jira" connected={connected} source={c?.source ?? 'none'} detail={detail} />}
      {done && <InlineNotification hideCloseButton lowContrast kind="success" title="Jira is connected" subtitle="Jira accepted the sign-in and can see the project. The token is stored encrypted and is not shown again." data-testid="connected-jira" />}
      {connected && (
        <div className={styles.actions}>
          <Button kind="ghost" size="sm" data-testid="replace-jira" onClick={() => setReplacing((r) => !r)}>
            {replacing ? 'Cancel' : own ? 'Replace token' : 'Use its own Jira'}
          </Button>
          {own && (
            <Button kind="ghost" size="sm" data-testid="disconnect-jira" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </div>
      )}
      {showForm && (
        <ConnectForm
          kind="jira"
          intro={<>Create an API token at id.atlassian.com (Security, API tokens) for the Jira account that should own the tickets. It is tried against Jira first, then stored encrypted, and never shown again.</>}
          fields={[
            { key: 'baseUrl', label: 'Jira address', placeholder: 'yourcompany.atlassian.net', helper: 'https:// is added if you leave it out.', initial: c?.siteUrl ?? '' },
            { key: 'email', label: 'Jira account email', placeholder: 'you@yourcompany.com', initial: c?.email ?? '' },
            { key: 'token', label: 'Jira API token', secret: true },
            { key: 'projectKey', label: 'Project key', placeholder: 'ACME', helper: 'The capital letters in front of the issue numbers.', initial: c?.projectKey ?? '' },
          ]}
          submitLabel={replacing ? 'Replace token' : 'Connect Jira'}
          pending={connect.isPending}
          error={connect.isError ? connect.error : null}
          onSubmit={async (v) => {
            await connect.mutateAsync({ baseUrl: v.baseUrl, email: v.email, token: v.token, projectKey: v.projectKey })
            setReplacing(false)
            setDone(true)
          }}
        />
      )}
      <DisconnectModal kind="jira" name="Jira" open={confirming} pending={disconnect.isPending} error={disconnect.isError ? disconnect.error : null} extra="Tickets already made stay in Jira. Where this deployment has its own Jira, that applies again." onClose={() => setConfirming(false)} onConfirm={async () => { try { await disconnect.mutateAsync('jira'); setConfirming(false); setDone(false) } catch { /* shown */ } }} />
    </section>
  )
}
