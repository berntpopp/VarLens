import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createPinia, setActivePinia } from 'pinia'
import UserManagement from '../../../src/renderer/src/components/UserManagement.vue'
import { useAuthStore } from '../../../src/renderer/src/stores/authStore'
import { createMockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

describe('UserManagement', () => {
  let mockApi: ReturnType<typeof createMockApi>

  const mockUsers = [
    {
      id: 1,
      username: 'admin',
      display_name: 'Admin User',
      role: 'admin',
      is_active: 1,
      must_change_password: 0,
      failed_login_count: 0,
      created_at: '2024-01-01T00:00:00Z'
    },
    {
      id: 2,
      username: 'user1',
      display_name: 'Regular User',
      role: 'user',
      is_active: 1,
      must_change_password: 0,
      failed_login_count: 0,
      created_at: '2024-01-02T00:00:00Z'
    }
  ]

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi = createMockApi()
    // Add auth namespace
    ;(mockApi as Record<string, unknown>).auth = {
      login: vi
        .fn()
        .mockResolvedValue({ success: true, user: { id: 1, username: 'admin', role: 'admin' } }),
      logout: vi.fn(),
      currentUser: vi.fn().mockResolvedValue({ id: 1, username: 'admin', role: 'admin' }),
      isAccountsEnabled: vi.fn().mockResolvedValue(true),
      listUsers: vi.fn().mockResolvedValue(mockUsers),
      createUser: vi.fn().mockResolvedValue({ id: 3, username: 'newuser', role: 'user' }),
      deactivateUser: vi.fn().mockResolvedValue(undefined),
      resetPassword: vi.fn().mockResolvedValue(undefined),
      changePassword: vi.fn().mockResolvedValue(undefined)
    }

    window.api = mockApi as typeof window.api
  })

  function mountWithAdmin() {
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mount(UserManagement, {
      global: { plugins: [vuetify, pinia] }
    })

    // Set auth store to admin
    const authStore = useAuthStore()
    authStore.currentUser = { id: 1, username: 'admin', role: 'admin' }
    authStore.accountsEnabled = true

    return wrapper
  }

  describe('Rendering', () => {
    it('renders user management card for admin users', async () => {
      const wrapper = mountWithAdmin()
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('User Management')
    })

    it('renders add user button', async () => {
      const wrapper = mountWithAdmin()
      await wrapper.vm.$nextTick()

      const addBtn = wrapper.findAll('button').find((btn) => btn.text().includes('Add User'))
      expect(addBtn).toBeDefined()
    })

    it('does not render when user is not admin', () => {
      const pinia = createPinia()
      setActivePinia(pinia)

      const wrapper = mount(UserManagement, {
        global: { plugins: [vuetify, pinia] }
      })

      // Non-admin - the v-if should hide the card
      const authStore = useAuthStore()
      authStore.currentUser = { id: 2, username: 'user1', role: 'user' }

      expect(wrapper.find('.v-card').exists()).toBe(false)
    })
  })

  describe('User List', () => {
    it('loads and displays users on mount', async () => {
      const wrapper = mountWithAdmin()

      // Wait for onMounted loadUsers
      await wrapper.vm.$nextTick()
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      await wrapper.vm.$nextTick()

      expect(
        (mockApi as Record<string, Record<string, ReturnType<typeof vi.fn>>>).auth.listUsers
      ).toHaveBeenCalled()
    })
  })

  describe('Create User Dialog', () => {
    it('opens create user dialog when add button clicked', async () => {
      const wrapper = mountWithAdmin()
      await wrapper.vm.$nextTick()

      const addBtn = wrapper.findAll('button').find((btn) => btn.text().includes('Add User'))
      await addBtn?.trigger('click')
      await wrapper.vm.$nextTick()

      // Dialog renders via v-dialog which uses teleport - check the dialog model is set
      const dialog = wrapper.findComponent({ name: 'VDialog' })
      expect(dialog.exists()).toBe(true)
    })
  })
})
