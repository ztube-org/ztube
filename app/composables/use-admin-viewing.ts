import { computed, reactive, ref, watch } from 'vue'
import { ApiError, apiFetch, useApi } from '../../src/api'

export function useAdminViewing(childId: number) {
  const { data: timeData, refresh: refreshTimeSettings } = useApi<any>(`/api/admin/children/${childId}/time-settings`)
  const { data: watchTime, refresh: refreshWatchTime } = useApi<any>(`/api/admin/children/${childId}/watch-time`)
  const usageDays = ref<7 | 30>(7)
  const usage = ref<any>(null)
  const refreshUsage = async () => { usage.value = await apiFetch(`/api/admin/children/${childId}/usage?days=${usageDays.value}`) }
  void refreshUsage()
  watch(usageDays, refreshUsage)

  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const timeForm = reactive({
    timeZone: detectedTimeZone,
    weekdayAllowanceMinutes: 60,
    weekendAllowanceMinutes: 120,
    safetyCapMinutes: 180,
    allowedStartMinute: 0,
    allowedEndMinute: 1440,
    breakAfterMinutes: 0,
    breakDurationMinutes: 15,
  })
  const timeSaving = ref(false)
  const timeError = ref('')
  const timeSaved = ref(false)
  const allowanceOptions = Array.from({ length: 97 }, (_, index) => ({ label: `${index * 15} minutes`, value: index * 15 }))
  const clockOptions = Array.from({ length: 96 }, (_, index) => {
    const minute = index * 15
    const hour = Math.floor(minute / 60)
    return { label: new Date(2000, 0, 1, hour, minute % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), value: minute }
  })
  const endClockOptions = [...clockOptions.slice(1), { label: '12:00 AM (next day)', value: 1440 }]
  const breakAfterOptions = [{ label: 'No required breaks', value: 0 }, ...Array.from({ length: 16 }, (_, index) => ({ label: `After ${(index + 1) * 15} minutes`, value: (index + 1) * 15 }))]
  const breakDurationOptions = Array.from({ length: 12 }, (_, index) => ({ label: `${(index + 1) * 5} minutes`, value: (index + 1) * 5 }))
  const timeZoneOptions = computed(() => {
    const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf
    const zones = supportedValuesOf?.('timeZone') ?? ['UTC', detectedTimeZone]
    return [...new Set(zones)].map(value => ({ label: value.replaceAll('_', ' '), value }))
  })
  watch(() => timeData.value?.settings, settings => { if (settings) Object.assign(timeForm, settings) }, { immediate: true })

  async function saveTimeSettings() {
    timeSaving.value = true
    timeError.value = ''
    timeSaved.value = false
    try {
      try {
        await apiFetch(`/api/admin/children/${childId}/time-settings`, { method: 'PUT', body: timeForm })
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409 || error.response.requiresConfirmation !== true
          || !confirm(`${error.message}\n\nSave these recurring allowances anyway?`)) throw error
        await apiFetch(`/api/admin/children/${childId}/time-settings`, { method: 'PUT', body: { ...timeForm, confirmReduction: true } })
      }
      await Promise.all([refreshTimeSettings(), refreshWatchTime()])
      timeSaved.value = true
    } catch (error) {
      timeError.value = error instanceof Error ? error.message : 'Failed to save time settings'
    } finally { timeSaving.value = false }
  }

  const interventionSaving = ref(false)
  async function updateViewing(action: () => Promise<unknown>) {
    interventionSaving.value = true
    try { await action(); await refreshWatchTime() } finally { interventionSaving.value = false }
  }
  const extendToday = (bucket: 'restricted' | 'exempt', minutes: 15 | 30 | 60) => updateViewing(() => apiFetch(`/api/admin/children/${childId}/watch-time/extensions`, { method: 'POST', body: { bucket, minutes } }))
  const setRestrictedUnlock = (unlocked: boolean) => updateViewing(() => apiFetch(`/api/admin/children/${childId}/watch-time/restricted-unlock`, { method: 'PUT', body: { unlocked } }))
  const setViewingPause = (paused: boolean) => updateViewing(() => apiFetch(`/api/admin/children/${childId}/watch-time/viewing-pause`, { method: 'PUT', body: { paused } }))

  return {
    timeData, watchTime, usageDays, usage, detectedTimeZone, timeForm, timeSaving, timeError, timeSaved,
    allowanceOptions, clockOptions, endClockOptions, breakAfterOptions, breakDurationOptions, timeZoneOptions,
    saveTimeSettings, interventionSaving, extendToday, setRestrictedUnlock, setViewingPause,
  }
}
