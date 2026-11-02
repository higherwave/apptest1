// The address checks behind thumbnail capture: the server must never be talked into visiting a private or internal address.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertCapturable, CaptureError, isPrivateAddress } from './capture.js'

const PUBLIC = async () => ['93.184.216.34']
const refused = (link: string, lookup: (h: string) => Promise<string[]> = PUBLIC) => assert.rejects(assertCapturable(link, { lookup }), CaptureError, link)

test('private, loopback, link-local and reserved addresses are recognised, in both IP versions', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.5'])
    assert.equal(isPrivateAddress(ip), true, ip)
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', '::10.0.0.1'])
    assert.equal(isPrivateAddress(ip), true, ip)
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.15.0.1', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '::ffff:8.8.8.8'])
    assert.equal(isPrivateAddress(ip), false, ip)
  assert.equal(isPrivateAddress('not an address'), true)
})

test('only ordinary public web pages are accepted', async () => {
  assert.equal((await assertCapturable('https://www.figma.com/design/abc', { lookup: PUBLIC })).hostname, 'www.figma.com')
  assert.ok(await assertCapturable('http://example.com/p?x=1#top', { lookup: PUBLIC }))
  assert.ok(await assertCapturable('https://example.com:443/p', { lookup: PUBLIC }))
  await refused('ftp://example.com/file')
  await refused('file:///etc/passwd')
  await refused('javascript:alert(1)')
  await refused('not a url')
  await refused('https://user:pass@example.com/')
  await refused('https://example.com:8443/')
  await refused('http://localhost/')
  await refused('http://localhost:3000/')
  await refused('http://intranet/')
  await refused('https://wiki.corp/')
  await refused('https://printer.local/')
  await refused('https://db.internal/')
  await refused('http://127.0.0.1/')
  await refused('http://[::1]/')
  await refused('http://169.254.169.254/latest/meta-data/')
  await refused('http://2130706433/') // 127.0.0.1 written as one number
  await refused('http://0x7f.1/') // and in hex
  await refused('http://[::ffff:10.0.0.1]/')
})

test('a public-looking name that resolves to a private address is refused, as is one that does not resolve', async () => {
  await refused('https://sneaky.example.com/', async () => ['10.0.0.5'])
  await refused('https://mixed.example.com/', async () => ['93.184.216.34', '192.168.0.9'])
  await refused('https://mapped.example.com/', async () => ['::ffff:127.0.0.1'])
  await refused('https://nowhere.example.com/', async () => [])
  await refused('https://gone.example.com/', async () => {
    throw new Error('ENOTFOUND')
  })
})

test('allowPrivate (tests only) lifts the address checks but never the scheme check', async () => {
  assert.ok(await assertCapturable('http://localhost:5198/about.html', { allowPrivate: true }))
  await assert.rejects(assertCapturable('file:///etc/passwd', { allowPrivate: true }), CaptureError)
})
