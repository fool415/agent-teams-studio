import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './primitives.module.css'

export type MenuEntry =
  | { readonly type: 'separator'; readonly id: string }
  | { readonly type: 'label'; readonly id: string; readonly text: string }
  | {
      readonly type?: 'item'
      readonly id: string
      readonly label: ReactNode
      readonly disabled?: boolean
    }

export interface MenuProps {
  readonly open: boolean
  readonly portal?: boolean
  readonly align?: 'start' | 'end'
  readonly compact?: boolean
  readonly className?: string
  readonly items: readonly MenuEntry[]
  readonly footer?: readonly MenuEntry[]
  readonly selectedId?: string
  readonly onSelect: (id: string) => void
  readonly onClose: () => void
  readonly anchor: ReactNode
}

export function Menu({
  open,
  portal = true,
  align = 'end',
  compact = false,
  className,
  items,
  footer,
  selectedId,
  onSelect,
  onClose,
  anchor,
}: MenuProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 260,
  })

  useLayoutEffect(() => {
    if (!open || anchorRef.current === null) return
    const update = () => {
      if (anchorRef.current === null) return
      const rect = anchorRef.current.getBoundingClientRect()
      const menuWidth = Math.max(rect.width, 260)
      const left =
        align === 'end'
          ? Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12))
          : Math.max(12, Math.min(rect.left, window.innerWidth - menuWidth - 12))
      const top = Math.min(rect.bottom + 6, Math.max(12, window.innerHeight - 360))
      setCoords({ top, left, width: menuWidth })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (
        target !== null
        && (anchorRef.current?.contains(target) || popupRef.current?.contains(target))
      ) {
        return
      }
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  const renderEntries = (entries: readonly MenuEntry[]) =>
    entries.map((entry) => {
      if (entry.type === 'separator') {
        return <div key={entry.id} className={css.menuSeparator} role="separator" />
      }
      if (entry.type === 'label') {
        return (
          <div key={entry.id} className={css.menuLabel}>
            {entry.text}
          </div>
        )
      }
      const selected = selectedId === entry.id
      return (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          className={css.menuItem}
          data-selected={selected || undefined}
          disabled={entry.disabled}
          onClick={() => onSelect(entry.id)}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{entry.label}</span>
          {selected && <span aria-hidden="true">✓</span>}
        </button>
      )
    })

  const popup = open ? (
    <div
      ref={popupRef}
      role="menu"
      className={css.menuPopup}
      data-compact={compact || undefined}
      style={
        portal
          ? { top: coords.top, left: coords.left, minWidth: coords.width }
          : { position: 'absolute', top: 'calc(100% + 6px)', right: align === 'end' ? 0 : undefined, left: align === 'start' ? 0 : undefined, minWidth: '100%' }
      }
    >
      {renderEntries(items)}
      {footer !== undefined && footer.length > 0 && (
        <>
          <div className={css.menuSeparator} role="separator" />
          {renderEntries(footer)}
        </>
      )}
    </div>
  ) : null

  return (
    <div ref={anchorRef} className={`${css.menuAnchor}${className ? ` ${className}` : ''}`}>
      {anchor}
      {popup !== null && (portal ? createPortal(popup, document.body) : popup)}
    </div>
  )
}

export interface ModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly closeLabel?: string
  readonly description?: string
  readonly footer?: ReactNode
  readonly children?: ReactNode
}

export function Modal({
  open,
  onClose,
  title,
  closeLabel = '取消',
  description,
  footer,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={css.modalBackdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={css.modalCard} onClick={(event) => event.stopPropagation()}>
        <header className={css.modalHeader}>
          <h3 className={css.modalTitle}>{title}</h3>
          <button type="button" className={css.modalClose} onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        {description && <p className={css.modalDesc}>{description}</p>}
        {children && <div className={css.modalBody}>{children}</div>}
        {footer && <footer className={css.modalFooter}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
