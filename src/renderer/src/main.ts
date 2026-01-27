import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import vuetify from './plugins/vuetify'
import './assets/styles/custom.css'

const app = createApp(App)

// Register Pinia first so stores work in components and services
app.use(createPinia())
app.use(vuetify)
app.mount('#app')
