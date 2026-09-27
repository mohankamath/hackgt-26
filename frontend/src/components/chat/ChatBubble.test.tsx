import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ChatBubble from './ChatBubble'
import { msg } from '../../test/factories'

const noop = () => {}
const renderBubble = (m: ReturnType<typeof msg>, onImageClick = noop) =>
  render(<ChatBubble msg={m} onImageClick={onImageClick} childName="Jimmy" childAvatar={null} />)

describe('ChatBubble', () => {
  it('renders safe text', () => {
    renderBubble(msg({ message: 'want to play later?' }))
    expect(screen.getByText('want to play later?')).toBeInTheDocument()
    expect(screen.getByText('sam')).toBeInTheDocument()
  })

  it('shows masked text and a chip, never the original', () => {
    renderBubble(msg({ status: 'masked', message: 'this is shit', masked_content: 'this is •••', coach_tip: 'Tip!' }))
    expect(screen.getByText('this is •••')).toBeInTheDocument()
    expect(screen.queryByText('this is shit')).not.toBeInTheDocument()
    expect(screen.getByText('Some words were hidden')).toBeInTheDocument()
    expect(screen.getByText('Tip!')).toBeInTheDocument()
  })

  it('hides censored content and shows the coach tip', () => {
    renderBubble(msg({ status: 'censored', censored: true, message: 'something awful', coach_tip: 'Tell a grown-up.' }))
    expect(screen.queryByText('something awful')).not.toBeInTheDocument()
    expect(screen.getByText('We hid this message to keep you safe')).toBeInTheDocument()
    expect(screen.getByText('Tell a grown-up.')).toBeInTheDocument()
  })

  it('shows a waiting state for needs_review', () => {
    renderBubble(msg({ status: 'needs_review', message: 'unknown' }))
    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
    expect(screen.getByText('A grown-up is double-checking this message')).toBeInTheDocument()
  })

  it('blurs only the flagged image and has no reveal', () => {
    const onClick = vi.fn()
    renderBubble(
      msg({
        message: 'pics',
        attachments: [
          { url: 'https://cdn/ok.png', filename: 'ok.png', type: 'image/png', kind: 'image', status: 'safe' },
          { url: null, filename: 'bad.png', type: 'image/png', kind: 'image', status: 'censored', flagged: true },
        ],
      }),
      onClick,
    )
    const imgs = screen.getAllByRole('img').filter((el) => el.tagName === 'IMG')
    expect(imgs.map((i) => i.getAttribute('src'))).toContain('https://cdn/ok.png')
    expect(imgs.map((i) => i.getAttribute('src'))).not.toContain(null)
    expect(screen.getByText('Picture hidden to keep you safe')).toBeInTheDocument()
    fireEvent.click(screen.getByAltText('ok.png'))
    expect(onClick).toHaveBeenCalledWith('https://cdn/ok.png')
  })

  it('replaces a flagged avatar with the default', () => {
    const { container } = renderBubble(msg({ profile_picture: 'https://cdn/bad-avatar.png', profile_picture_flagged: true }))
    expect(container.querySelector('img[src="https://cdn/bad-avatar.png"]')).toBeNull()
  })

  it('uses the configured child name on sent messages', () => {
    renderBubble(msg({ is_sent: true, message: 'hey!' }))
    expect(screen.getByText('Jimmy')).toBeInTheDocument()
  })
})
