import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createPinia, setActivePinia } from 'pinia'
import LoginView from '../../../src/renderer/src/components/LoginView.vue'
import { createMockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

describe('LoginView', () => {
  let mockApi: ReturnType<typeof createMockApi>

  beforeEach(() => {
    setActivePinia(createPinia())
    mockApi = createMockApi()
    // Add auth namespace to mock
    ;(mockApi as Record<string, unknown>).auth = {
      login: vi.fn().mockResolvedValue({ success: false, user: null }),
      logout: vi.fn(),
      currentUser: vi.fn().mockResolvedValue(null),
      isAccountsEnabled: vi.fn().mockResolvedValue(true),
      changePassword: vi.fn().mockResolvedValue(undefined)
    }

    window.api = mockApi as typeof window.api
  })

  function mountLoginView() {
    return mount(LoginView, {
      global: { plugins: [vuetify] }
    })
  }

  describe('Rendering', () => {
    it('renders the login form', () => {
      const wrapper = mountLoginView()
      expect(wrapper.find('.v-card').exists()).toBe(true)
      expect(wrapper.text()).toContain('VarLens')
      expect(wrapper.text()).toContain('Sign in to continue')
    })

    it('renders username and password fields', () => {
      const wrapper = mountLoginView()
      const inputs = wrapper.findAll('.v-text-field')
      expect(inputs.length).toBeGreaterThanOrEqual(2)
    })

    it('renders sign in button', () => {
      const wrapper = mountLoginView()
      const signInBtn = wrapper.findAll('button').find((btn) => btn.text().includes('Sign In'))
      expect(signInBtn).toBeDefined()
    })

    it('disables sign in button when fields are empty', () => {
      const wrapper = mountLoginView()
      const signInBtn = wrapper.findAll('button').find((btn) => btn.text().includes('Sign In'))
      expect(signInBtn?.attributes('disabled')).toBeDefined()
    })
  })

  describe('Login Flow', () => {
    it('calls login on form submit', async () => {
      const wrapper = mountLoginView()

      // Set values via component internals since v-model binding
      const inputs = wrapper.findAll('input')
      await inputs[0].setValue('testuser')
      await inputs[1].setValue('password123')

      const form = wrapper.find('form')
      await form.trigger('submit.prevent')

      // The auth store's login should have been called
      // We check the mock API was invoked
      expect(
        (mockApi as Record<string, Record<string, ReturnType<typeof vi.fn>>>).auth.login
      ).toHaveBeenCalledWith('testuser', 'password123')
    })

    it('shows error message on failed login', async () => {
      const wrapper = mountLoginView()

      const inputs = wrapper.findAll('input')
      await inputs[0].setValue('testuser')
      await inputs[1].setValue('wrongpass')

      const form = wrapper.find('form')
      await form.trigger('submit.prevent')

      // Wait for async operations
      await wrapper.vm.$nextTick()
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('Invalid username or password')
    })

    it('shows locked message when account is locked', async () => {
      ;(
        mockApi as Record<string, Record<string, ReturnType<typeof vi.fn>>>
      ).auth.login.mockResolvedValue({
        success: false,
        user: null,
        locked: true
      })

      const wrapper = mountLoginView()

      const inputs = wrapper.findAll('input')
      await inputs[0].setValue('lockeduser')
      await inputs[1].setValue('password')

      const form = wrapper.find('form')
      await form.trigger('submit.prevent')

      await wrapper.vm.$nextTick()
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('temporarily locked')
    })
  })

  describe('Password Change Flow', () => {
    it('shows password change form when mustChangePassword is true', async () => {
      ;(
        mockApi as Record<string, Record<string, ReturnType<typeof vi.fn>>>
      ).auth.login.mockResolvedValue({
        success: true,
        user: { id: 1, username: 'testuser', role: 'user' },
        mustChangePassword: true
      })

      const wrapper = mountLoginView()

      const inputs = wrapper.findAll('input')
      await inputs[0].setValue('testuser')
      await inputs[1].setValue('temppass')

      const form = wrapper.find('form')
      await form.trigger('submit.prevent')

      await wrapper.vm.$nextTick()
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      await wrapper.vm.$nextTick()

      expect(wrapper.text()).toContain('Change your password')
      expect(wrapper.text()).toContain('must change your password')
    })
  })
})
