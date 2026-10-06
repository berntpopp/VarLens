import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { LinkOutsCell } from '../../../../src/renderer/src/components/table-cells/simple-cells'

const links = [
  { key: '_link_varsome', name: 'VarSome', abbreviation: 'VS' },
  { key: '_link_pubtator', name: 'PubTator', abbreviation: 'PT' }
]

describe('LinkOutsCell (merged Links column)', () => {
  it('renders one keyboard-reachable anchor per resolved link with an accessible name', () => {
    const w = mount(LinkOutsCell, {
      props: {
        links,
        urls: { _link_varsome: 'https://varsome.com/x', _link_pubtator: 'https://pubtator/x' }
      }
    })
    const anchors = w.findAll('a')
    expect(anchors).toHaveLength(2)
    expect(anchors[0].attributes('href')).toBe('https://varsome.com/x')
    expect(anchors[0].attributes('aria-label')).toBe('Open in VarSome (opens in a new tab)')
    expect(anchors[0].attributes('data-tooltip')).toBe('VarSome')
    expect(anchors[0].text()).toBe('VS')
    expect(anchors[1].attributes('rel')).toContain('noopener')
  })

  it('keeps an inert spacer for a link that cannot resolve, so badges align across rows', () => {
    const w = mount(LinkOutsCell, {
      props: { links, urls: { _link_varsome: 'https://varsome.com/x', _link_pubtator: null } }
    })
    expect(w.findAll('a')).toHaveLength(1)
    const spacer = w.find('.link-outs__badge--empty')
    expect(spacer.exists()).toBe(true)
    expect(spacer.attributes('aria-hidden')).toBe('true')
  })

  it('renders a placeholder when no link resolves', () => {
    const w = mount(LinkOutsCell, { props: { links, urls: {} } })
    expect(w.find('a').exists()).toBe(false)
    expect(w.text()).not.toBe('')
  })

  it('intercepts the click and re-emits the URL (Electron routes via shell.openExternal)', () => {
    const w = mount(LinkOutsCell, {
      props: { links, urls: { _link_varsome: 'https://varsome.com/x' } }
    })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    w.get('a').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(w.emitted('click')?.[0]?.[0]).toBe('https://varsome.com/x')
  })
})
