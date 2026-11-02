# Try company sign-in on your own machine

Before a company deploys Signal Flow, you can sign in to it with their real identity provider (Okta, Entra ID, Keycloak, Auth0) from
your laptop. It runs the real sign-in code against a throwaway copy of the demo data: nothing touches a deployment or a database you keep.

    npm run sso:try

Open the address it prints (`http://localhost:5198`), choose "Continue with ...", sign in at the provider, and the terminal prints one line
saying who signed in and as which role. Ctrl+C stops it and the data is gone.

## 1. A free Okta tenant

Sign up for a free developer account at https://developer.okta.com (the free plan's name has changed over the years; any plan that lets
you create an application is enough). Then, in its **Admin Console**:

1. **Applications > Applications > Create App Integration > OIDC - OpenID Connect > Web Application**.
2. Name it, keep the grant type **Authorization Code**, and set **Sign-in redirect URIs** to exactly:
   `http://localhost:5198/api/v1/auth/callback/oidc`
3. Under **Assignments** choose "Allow everyone in your organization to access" (fine for a test), then **Save**.
4. On the **General** tab copy the **Client ID** and **Client secret**. Your Okta domain (top right, like `dev-12345678.okta.com`) gives the issuer:
   `https://dev-12345678.okta.com`.

For role-from-groups testing, also:

5. **Directory > Groups > Add group**: make `signalflow-owners`, `signalflow-editors` and `signalflow-viewers`, and add yourself to one of them.
6. Back on the application, **Sign On** tab > **OpenID Connect ID Token** > **Edit**: Groups claim type **Filter**, claim name `groups`,
   **Matches regex** `.*`. Save. (Okta only sends groups when the application is told to.)

## 2. The settings file

Create `db/.env.sso.local` (the `.local` ending keeps it out of git; never paste its contents into a chat or a ticket):

    OIDC_ISSUER=https://dev-12345678.okta.com
    OIDC_CLIENT_ID=...
    OIDC_CLIENT_SECRET=...
    OIDC_NAME=Okta
    OIDC_SCOPES=openid profile email groups
    SSO_TRY_OWNER_EMAIL=you@yourcompany.com

`SSO_TRY_OWNER_EMAIL` is the address you sign in with; it is invited as the owner of the throwaway workspace. To try roles from groups, add:

    SSO_OWNER_GROUPS=signalflow-owners
    SSO_EDITOR_GROUPS=signalflow-editors
    SSO_VIEWER_GROUPS=signalflow-viewers

## 3. What to try

| Try | You should see |
| --- | --- |
| Sign in with the owner address | `signed in: you@... as owner` |
| Sign in as a second Okta user nobody invited | `refused (403): not_invited` |
| Add `SSO_DEFAULT_ROLE=viewer`, restart, sign in as that second user | `as viewer` |
| Turn on the group settings, restart, sign in | The role of your group; the Members page is read-only |
| Move yourself to another group in Okta, sign out, sign in again | The role changes at the next sign-in |
| Remove yourself from every group, sign in again | `refused (403): not_in_group` |

## 4. When something is wrong

| What you see | Usually |
| --- | --- |
| "The sign-in provider could not be reached" | `OIDC_ISSUER` is wrong, or has a path it should not (use `https://<domain>`, no trailing path) |
| The provider says the redirect URI is invalid | The redirect URI in the application is not exactly `http://localhost:5198/api/v1/auth/callback/oidc` (check the port) |
| `invalid_client` | The client secret is wrong or was regenerated |
| Signed in as the right person but `not_in_group` | The groups claim is not being sent: check step 6 and that `groups` is in `OIDC_SCOPES` |
| `not_invited` for the owner address | `SSO_TRY_OWNER_EMAIL` differs from the address Okta signs you in with |
| "id_token failed verification" in the terminal | The issuer in `OIDC_ISSUER` is not the one that signed the token. Use the address Okta shows as the issuer |

## Other providers

The same file works for any OpenID Connect provider: set `OIDC_ISSUER` to its issuer address and register the same redirect URI. Entra ID: the
issuer is `https://login.microsoftonline.com/<tenant-id>/v2.0`, add the optional `email` claim to the ID token, and send groups in the `groups`
claim (as ids or names). Keycloak: the issuer is `https://<host>/realms/<realm>`, and groups are usually in a claim you map yourself; set
`OIDC_GROUPS_CLAIM` to its name.
