import { Button, InlineNotification, Modal } from '@carbon/react'
import { friendlyMessage } from '../api/client'
import { useCreateSlackConnectCode, useDisconnectMySlack, useMySlack } from '../api/hooks'
import styles from './SlackConnectModal.module.scss'

// Connecting Slack: a one-time code is made here and entered in Slack as /signalflow connect <code>. That is how a click on an approval card in Slack is known
// to be this person; nothing on the Slack account (a name, an email) is trusted.
export function SlackConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useMySlack()
  const make = useCreateSlackConnectCode()
  const disconnect = useDisconnectMySlack()
  const connected = !!status.data?.connected
  const error = make.isError ? make.error : disconnect.isError ? disconnect.error : undefined
  return (
    <Modal open={open} passiveModal size="sm" modalHeading="Connect Slack" onRequestClose={() => { make.reset(); onClose() }}>
      <div className={styles.body} data-testid="slack-connect">
        {error && <InlineNotification kind="error" lowContrast hideCloseButton title="That did not work" subtitle={friendlyMessage(error)} />}
        {connected ? (
          <>
            <p className={styles.text} data-testid="slack-connected">Your Slack account is connected. The answer buttons on a launch’s Slack thread now work for the steps you review.</p>
            <Button kind="tertiary" size="md" disabled={disconnect.isPending} onClick={() => disconnect.mutate()} data-testid="slack-disconnect">Disconnect Slack</Button>
          </>
        ) : make.data ? (
          <>
            <p className={styles.text}>In Slack, in any channel or message box, enter:</p>
            <p className={styles.code} data-testid="slack-command">/signalflow connect {make.data.code}</p>
            <p className={styles.small}>The code works once and for ten minutes. Only you see Slack’s reply.</p>
            <Button kind="ghost" size="sm" onClick={() => void status.refetch()} data-testid="slack-check">I have entered it</Button>
          </>
        ) : (
          <>
            <p className={styles.text}>Connect your Slack account so you can answer a launch’s approval card without leaving Slack. You get a one-time code and enter it in Slack.</p>
            <Button kind="primary" size="md" disabled={make.isPending} onClick={() => make.mutate()} data-testid="slack-get-code">Get a code</Button>
          </>
        )}
      </div>
    </Modal>
  )
}
