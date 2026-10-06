import { ipcRenderer } from 'electron'
import { JOBS_CHANNELS, type JobsApi } from '../../shared/ipc/domains/jobs'
import { subscribeToIpcEvent } from '../window-api/events'

export function createJobsApi(): JobsApi {
  return {
    list: (filter) => ipcRenderer.invoke(JOBS_CHANNELS.list, filter),
    get: (jobId) => ipcRenderer.invoke(JOBS_CHANNELS.get, jobId),
    progress: (jobId) => ipcRenderer.invoke(JOBS_CHANNELS.progress, jobId),
    cancel: (jobId) => ipcRenderer.invoke(JOBS_CHANNELS.cancel, jobId),
    onChanged: (callback) => subscribeToIpcEvent(JOBS_CHANNELS.changed, callback)
  }
}
