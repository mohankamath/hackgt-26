import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon,
  GearIcon,
  EyeSlashIcon,
  EyeIcon,
  TagIcon,
  PlusIcon,
  XCircleIcon,
  SlidersHorizontalIcon,
  SmileyIcon,
} from '@phosphor-icons/react'
import { useSettings } from '../hooks/useSettings'
import type { Sensitivity } from '../types/safety'
import { Avatar } from '../components/common/ui'

const SENSITIVITY: { key: Sensitivity; label: string; desc: string }[] = [
  { key: 'low', label: 'Relaxed', desc: 'Only clear-cut harmful content is hidden. Good for teens.' },
  { key: 'balanced', label: 'Balanced', desc: 'Recommended. Hides harmful content, masks swear words.' },
  { key: 'strict', label: 'Strict', desc: 'Hides borderline content too. Good for younger kids.' },
]

const inputCls =
  'bg-soft-peach-50 border border-rust-brown-100 rounded-xl px-4 py-2.5 text-sm text-ink-black-800 placeholder:text-ink-black-300 outline-none focus:border-rust-brown-300 focus:ring-2 focus:ring-rust-brown-100 transition-all disabled:opacity-50'

function Section({ icon, title, desc, children, action }: { icon: React.ReactNode; title: string; desc: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-carrot-orange-50 flex items-center justify-center shrink-0 text-carrot-orange-500">{icon}</div>
        <div className="flex-1">
          <h2 className="text-base font-bold text-ink-black-800 m-0">{title}</h2>
          <p className="text-sm text-ink-black-400 mt-1 mb-0">{desc}</p>
        </div>
        {action}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  )
}

function SettingsPage() {
  const navigate = useNavigate()
  const { settings, loading, updateSettings, addKeyword, removeKeyword } = useSettings()
  const [newKeyword, setNewKeyword] = useState('')
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!loading) {
      setName(settings.childName === 'Your child' ? '' : settings.childName)
      setAvatar(settings.childAvatar)
    }
  }, [loading, settings.childName, settings.childAvatar])

  const run = async (fn: () => Promise<unknown>) => {
    setSaving(true)
    try {
      await fn()
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  const handleAddKeyword = () => {
    const trimmed = newKeyword.trim()
    if (!trimmed) return
    run(async () => {
      await addKeyword(trimmed)
      setNewKeyword('')
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-soft-peach-50 flex items-center justify-center">
        <p className="text-ink-black-300 text-sm">Loading settings…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-soft-peach-50 flex flex-col">
      <header className="bg-spicy-orange-500 text-white px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/parent-dashboard')} className="bg-white/20 border-none text-white px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer hover:bg-white/35 transition-colors flex items-center gap-1.5">
          <ArrowLeftIcon size={16} weight="bold" aria-hidden /> Back
        </button>
        <div className="flex items-center gap-2">
          <GearIcon size={24} weight="bold" aria-hidden />
          <h1 className="text-xl font-bold m-0">Settings</h1>
        </div>
        <span className="ml-auto text-sm font-semibold" role="status">{saved ? 'Saved ✓' : saving ? 'Saving…' : ''}</span>
      </header>

      <main className="flex-1 px-6 py-6 max-w-2xl mx-auto w-full flex flex-col gap-6">
        <Section icon={<SmileyIcon size={22} weight="duotone" />} title="Your child" desc="Shown in your child's chat and used in digests and alerts.">
          <div className="flex items-center gap-4">
            <Avatar src={avatar || null} size={56} />
            <div className="flex-1 flex flex-col gap-2">
              <label className="text-xs font-bold text-ink-black-500">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jimmy" maxLength={40} className={`${inputCls} w-full mt-1`} />
              </label>
              <label className="text-xs font-bold text-ink-black-500">
                Avatar image URL (optional)
                <input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" className={`${inputCls} w-full mt-1`} />
              </label>
              <button
                onClick={() => run(() => updateSettings({ childName: name.trim() || 'Your child', childAvatar: avatar.trim() }))}
                disabled={saving}
                className="self-start px-4 py-2 rounded-xl text-sm font-semibold border-none cursor-pointer bg-spicy-orange-500 text-white hover:bg-spicy-orange-600 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </Section>

        <Section icon={<SlidersHorizontalIcon size={22} weight="duotone" />} title="Filter sensitivity" desc="How cautious the AI filter is. Changes apply to new messages within a minute.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Filter sensitivity">
            {SENSITIVITY.map((s) => (
              <button
                key={s.key}
                role="radio"
                aria-checked={settings.sensitivity === s.key}
                onClick={() => run(() => updateSettings({ sensitivity: s.key }))}
                className={`text-left rounded-xl p-3 border-2 cursor-pointer transition-colors ${
                  settings.sensitivity === s.key ? 'border-spicy-orange-500 bg-spicy-orange-50' : 'border-soft-peach-100 bg-white hover:bg-soft-peach-50'
                }`}
              >
                <p className="text-sm font-bold text-ink-black-800 m-0">{s.label}</p>
                <p className="text-xs text-ink-black-400 mt-1 mb-0">{s.desc}</p>
              </button>
            ))}
          </div>
        </Section>

        <Section
          icon={settings.privacyMode ? <EyeSlashIcon size={22} weight="duotone" /> : <EyeIcon size={22} weight="duotone" />}
          title="Privacy mode"
          desc="Respect your child's privacy: the dashboard only shows flagged messages and risky conversations, never everyday chats."
          action={
            <button
              role="switch"
              aria-checked={settings.privacyMode}
              aria-label="Privacy mode"
              onClick={() => run(() => updateSettings({ privacyMode: !settings.privacyMode }))}
              className={`relative w-14 h-8 rounded-full border-none cursor-pointer transition-colors shrink-0 ${settings.privacyMode ? 'bg-spicy-orange-500' : 'bg-ink-black-200'}`}
            >
              <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${settings.privacyMode ? 'left-7' : 'left-1'}`} />
            </button>
          }
        />

        <Section icon={<TagIcon size={22} weight="duotone" />} title="Custom keywords" desc="Words or phrases to hide in messages your child receives (for example a nickname bullies use). They're masked, and the rest of the message still shows.">
          <div className="flex gap-2 mb-4">
            <label htmlFor="kw" className="sr-only">New keyword</label>
            <input
              id="kw"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddKeyword() } }}
              placeholder="Enter a keyword…"
              disabled={saving}
              className={`${inputCls} flex-1`}
            />
            <button onClick={handleAddKeyword} disabled={!newKeyword.trim() || saving} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border-none cursor-pointer bg-spicy-orange-500 text-white hover:bg-spicy-orange-600 disabled:opacity-40 disabled:cursor-not-allowed">
              <PlusIcon size={16} weight="bold" aria-hidden /> Add
            </button>
          </div>
          {settings.customKeywords.length === 0 ? (
            <p className="text-sm text-ink-black-300 text-center py-4">No custom keywords yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
              {[...settings.customKeywords].sort().map((kw) => (
                <li key={kw} className="flex items-center gap-1.5 bg-soft-peach-100 text-ink-black-700 text-sm font-medium px-3 py-1.5 rounded-lg">
                  {kw}
                  <button onClick={() => run(() => removeKeyword(kw))} aria-label={`Remove ${kw}`} className="bg-transparent border-none cursor-pointer p-0 text-ink-black-400 hover:text-red-500 transition-colors flex items-center">
                    <XCircleIcon size={16} weight="bold" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </main>
    </div>
  )
}

export default SettingsPage
