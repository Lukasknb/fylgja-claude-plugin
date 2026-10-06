import type { Host } from './host'
import * as Library from './library'
import { referenceOf } from './refs'
import type { Ref } from './refs'
import * as View from './view'

/** Everything the plugin keeps while it runs. */
export type Peek = { library: Library.Library; view: View.View }

export function create(): Peek {
  return { library: Library.create(), view: View.create() }
}

/**
 * Shows a record: it becomes the one on show, its reading starts in the
 * background, and the pane is opened. Where the surface places no pane the
 * same view is drawn in the band above the prompt instead.
 *
 * Only the opening of the pane is waited for, never Fylgja.
 */
export async function open(host: Host, peek: Peek, ref: Ref, wantsFocus: boolean): Promise<void> {
  View.show(peek.view, ref)
  void Library.load(host, peek.library, ref)

  const isPlaced = await host.openPane(wantsFocus).catch(() => false)

  peek.view.where = isPlaced ? 'pane' : 'band'
  host.redraw()
}

/** What the pane's controls do. Each returns at once; the drawing follows. */
export type Actions = {
  open: (ref: Ref) => void
  step: (by: -1 | 1) => void
  refresh: () => void
  copy: () => void
  close: () => void
  toggle: (section: string) => void
}

export function actionsOf(host: Host, peek: Peek): Actions {
  const { library, view } = peek

  return {
    open: ref => void open(host, peek, ref, false),

    step: by => {
      const shown = View.step(view, by) ? View.current(view) : undefined

      if (shown !== undefined) {
        void Library.load(host, library, shown)
        host.redraw()
      }
    },

    refresh: () => {
      const shown = View.current(view)

      if (shown !== undefined) {
        view.note = undefined
        void Library.load(host, library, shown, true)
      }
    },

    copy: () => {
      const shown = View.current(view)
      const held = shown === undefined ? undefined : library.records.get(shown.id)
      // The reference carries the record's own title, so it is written only once the record was read.
      const text = held?.state === 'ready' ? referenceOf(held.record.kind, held.record.title, held.record.id) : undefined

      if (text === undefined) {
        return
      }

      void host
        .insert(`${text} `)
        .catch(() => false)
        .then(isFilled => {
          view.note = isFilled ? { is: 'inserted' } : { is: 'refused', text }
          host.redraw()
        })
    },

    close: () => {
      view.where = 'closed'
      void host.closePane().catch(() => undefined)
      host.redraw()
    },

    toggle: section => {
      View.toggle(view, section)
      host.redraw()
    },
  }
}
