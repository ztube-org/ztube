import { useToast } from '@nuxt/ui/composables/useToast'
import { h } from 'vue'

export function useActionToast() {
  const toast = useToast()
  return (title: string, { announcedInline = false, color = 'success' }: { announcedInline?: boolean; color?: 'success' | 'warning' } = {}) =>
    toast.add({
      title: announcedInline ? () => h('span', { 'aria-hidden': 'true' }, title) : title,
      color,
      ui: color === 'success'
        ? { root: 'bg-[var(--zt-success-soft)]', icon: 'text-[var(--zt-success)]' }
        : { root: 'bg-[var(--zt-warning-soft)]', icon: 'text-[var(--zt-warning)]' },
      icon: color === 'success' ? 'i-heroicons-check-circle' : 'i-heroicons-exclamation-circle',
      type: 'background',
      close: { class: 'min-h-11 min-w-11 justify-center' },
    })
}
