import { useEffect, useState } from 'react'
import { EyeSlashIcon, TagIcon, PlusIcon, XIcon, SlidersHorizontalIcon, SmileyIcon, CheckCircleIcon, FeatherIcon, ScalesIcon, LockKeyIcon } from '@phosphor-icons/react'
import { useSettings } from '../hooks/useSettings'
import type { Sensitivity } from '../types/safety'
import ParentShell from '../components/common/ParentShell'
import { Avatar, Button } from '../components/common/ui'

const SENSITIVITY: { key: Sensitivity; label: string; desc: string; icon: typeof FeatherIcon }[] = [
  { key: 'low', label: 'Relaxed', desc: 'Only clear-cut harmful content is hidden. Good for teens.', icon: FeatherIcon },
  { key: 'balanced', label: 'Balanced', desc: 'Recommended. Hides harmful content, masks swear words.', icon: ScalesIcon },
  { key: 'strict', label: 'Strict', desc: 'Hides borderline content too. Good for younger kids.', icon: LockKeyIcon },
]

function Section({ icon, title, desc, children, action }: { icon: React.ReactNode; title: string; desc: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel p-6 animate-rise">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 ring-1 ring-accent/20 flex items-center justify-center shrink-0 text-accent">{icon}</div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold m-0">{title}</h2>
          <p className="text-sm text-muted mt-1 mb-0">{desc}</p>
        </div>
        {action}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  )
}

function SettingsPage() {
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

  return (
    <ParentShell
      title="Settings"
      subtitle="Tune how Screened protects your family"
      actions={
        <span className="text-sm text-muted flex items-center gap-1.5" role="status">
          {saved ? (
            <>
              <CheckCircleIcon size={16} weight="fill" className="text-ok" aria-hidden /> Saved
            </>
          ) : saving ? (
            'Saving…'
          ) : null}
        </span>
      }
    >
      {loading ? (
        <p className="text-muted text-sm">Loading settings…</p>
      ) : (
        <div className="max-w-3xl flex flex-col gap-5">
          <Section icon={<SmileyIcon size={22} weight="duotone" />} title="Your child" desc="Shown in your child's chat and used in digests and alerts.">
            <div className="flex items-center gap-5 flex-wrap">
              <Avatar src={avatar || null} size={64} className="ring-2 ring-accent/50" />
              <div className="flex-1 min-w-[240px] grid sm:grid-cols-2 gap-3">
                <label className="text-xs font-medium text-fg-soft">
                  Name
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jimmy" maxLength={40} className="field w-full mt-1.5 px-3.5 py-2.5 text-sm" />
                </label>
                <label className="text-xs font-medium text-fg-soft">
                  Avatar image URL (optional)
                  <input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://…" className="field w-full mt-1.5 px-3.5 py-2.5 text-sm" />
                </label>
              </div>
              <Button variant="primary" disabled={saving} onClick={() => run(() => updateSettings({ childName: name.trim() || 'Your child', childAvatar: avatar.trim() }))}>
                Save
              </Button>
            </div>
          </Section>

          <Section icon={<SlidersHorizontalIcon size={22} weight="duotone" />} title="Filter sensitivity" desc="How cautious the AI filter is. Changes apply to new messages within a minute.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Filter sensitivity">
              {SENSITIVITY.map(({ key, label, desc, icon: Icon }) => {
                const active = settings.sensitivity === key
                return (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={active}
                    onClick={() => run(() => updateSettings({ sensitivity: key }))}
                    className={`relative text-left rounded-xl p-4 border-none transition-all ring-1 ${active ? 'bg-accent/10 ring-accent/60 shadow-glow' : 'bg-surface-2 ring-line hover:ring-line-strong'}`}
                  >
                    <Icon size={20} weight="duotone" className={active ? 'text-accent' : 'text-muted'} aria-hidden />
                    <p className="text-sm font-semibold text-fg m-0 mt-2">{label}</p>
                    <p className="text-xs text-muted mt-1 mb-0 leading-relaxed">{desc}</p>
                    {active && <CheckCircleIcon size={18} weight="fill" className="absolute top-3 right-3 text-accent" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </Section>

          <Section
            icon={<EyeSlashIcon size={22} weight="duotone" />}
            title="Privacy mode"
            desc="Respect your child's privacy: the dashboard only shows flagged messages and risky conversations, never everyday chats."
            action={
              <button
                role="switch"
                aria-checked={settings.privacyMode}
                aria-label="Privacy mode"
                onClick={() => run(() => updateSettings({ privacyMode: !settings.privacyMode }))}
                className={`relative w-12 h-7 rounded-full border-none transition-colors shrink-0 ring-1 ${settings.privacyMode ? 'bg-accent ring-accent' : 'bg-surface-3 ring-line'}`}
              >
                <span className={`absolute top-1 w-5 h-5 rounded-full shadow transition-all ${settings.privacyMode ? 'left-6 bg-abyss' : 'left-1 bg-muted'}`} />
              </button>
            }
          />

          <Section
            icon={<TagIcon size={22} weight="duotone" />}
            title="Custom keywords"
            desc="Words or phrases to hide in messages your child receives, like a nickname bullies use. They're masked and the rest of the message still shows."
          >
            <div className="flex gap-2 mb-4">
              <label htmlFor="kw" className="sr-only">New keyword</label>
              <input
                id="kw"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddKeyword()
                  }
                }}
                placeholder="Add a word or phrase…"
                disabled={saving}
                className="field flex-1 px-3.5 py-2.5 text-sm"
              />
              <Button variant="primary" onClick={handleAddKeyword} disabled={!newKeyword.trim() || saving}>
                <PlusIcon size={15} weight="bold" aria-hidden /> Add
              </Button>
            </div>
            {settings.customKeywords.length === 0 ? (
              <p className="text-sm text-subtle text-center py-4 m-0 rounded-xl border border-dashed border-line">No custom keywords yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
                {[...settings.customKeywords].sort().map((kw) => (
                  <li key={kw} className="flex items-center gap-1.5 bg-surface-2 ring-1 ring-line text-fg-soft text-sm pl-3 pr-1.5 py-1 rounded-lg">
                    <span className="font-mono text-[0.8rem]">{kw}</span>
                    <button onClick={() => run(() => removeKeyword(kw))} aria-label={`Remove ${kw}`} className="w-6 h-6 rounded-md bg-transparent border-none text-subtle hover:text-danger hover:bg-danger/10 flex items-center justify-center transition-colors">
                      <XIcon size={13} weight="bold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </ParentShell>
  )
}

export default SettingsPage
