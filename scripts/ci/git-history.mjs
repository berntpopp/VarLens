// Shared by the hook and runner without creating a CLI import cycle.
export function outgoingHistory(commit, remote) {
  if (!/^[a-f0-9]{40,64}$/.test(commit) || !/^[a-zA-Z0-9_.-]+$/.test(remote))
    throw new Error('Invalid outgoing history identity')
  return `${commit} --not --remotes=${remote}`
}
