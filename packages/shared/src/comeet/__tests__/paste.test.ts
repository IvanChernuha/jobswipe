// The "Connect Comeet" popup (user 2026-11-27: "click here to add uid / and
// token"): two boxes, UID and Token, each with a Paste button. Whatever gets
// pasted (one value, both, labelled, or the API link) is sorted into the
// right box. Same patterns as backend services/comeet.py parse_credentials.
import { describe, expect, it } from 'vitest'
import { readComeetPaste } from '../index'

const TOKEN = '5E7236A0BCE5E7295111B55E70BCE'

describe('readComeetPaste', () => {
  it.each([
    `UID: E5.007\nToken: ${TOKEN}`,
    `uid E5.007   token ${TOKEN}`,
    `E5.007\n${TOKEN}`,
    `${TOKEN} E5.007`,
    `  Company UID = E5.007 , Token = ${TOKEN}  `,
    `https://www.comeet.co/careers-api/2.0/company/E5.007/positions?token=${TOKEN}&details=true`,
  ])('finds both in %j', (text) => {
    expect(readComeetPaste(text)).toEqual({ uid: 'E5.007', token: TOKEN })
  })

  it('one value on its own goes to its own box', () => {
    expect(readComeetPaste(' E5.007 ')).toEqual({ uid: 'E5.007', token: null })
    expect(readComeetPaste(TOKEN)).toEqual({ uid: null, token: TOKEN })
  })

  it('finds nothing in text without them', () => {
    expect(readComeetPaste('')).toEqual({ uid: null, token: null })
    expect(readComeetPaste('hello there')).toEqual({ uid: null, token: null })
    expect(readComeetPaste('UID: Token:')).toEqual({ uid: null, token: null })
  })
})
