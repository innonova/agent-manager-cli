import { describe, expect, it } from 'vitest'
import { joinCommand } from './commands.js'

describe('joinCommand', () => {
  it('passes one word through untouched', () => {
    expect(joinCommand(['echo "a  b" | tr a-z A-Z'])).toBe('echo "a  b" | tr a-z A-Z')
    expect(joinCommand([])).toBe('')
  })
  it('quotes again the words the caller must have quoted', () => {
    expect(joinCommand(['Get-Process', '-Name', 'my app'])).toBe("Get-Process -Name 'my app'")
    expect(joinCommand(['printf', '%s|', 'a  b'])).toBe("printf '%s|' 'a  b'")
    expect(joinCommand(['dir', 'C:\\Users'])).toBe("dir 'C:\\Users'")
    expect(joinCommand(['echo', "it's"])).toBe("echo 'it''s'")
    expect(joinCommand(['echo', 'say "hi"'])).toBe('echo \'say "hi"\'')
  })
  it('leaves plain words and variables alone', () => {
    expect(joinCommand(['Write-Output', '$env:USERNAME', '-x=1', 'a:b'])).toBe(
      'Write-Output $env:USERNAME -x=1 a:b',
    )
  })
})
