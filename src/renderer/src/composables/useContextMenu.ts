import { ref } from 'vue'

export function useContextMenu() {
  const show = ref(false)
  const x = ref(0)
  const y = ref(0)

  const open = (event: MouseEvent) => {
    x.value = event.clientX
    y.value = event.clientY
    show.value = true
  }

  const close = () => {
    show.value = false
  }

  return { show, x, y, open, close }
}
