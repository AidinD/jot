import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capture } from './CaptureView'
import { setJotApi } from '../jotApiClient'
import '../styles.css'

// Standalone shell: inject the preload bridge as the Jot data API before render.
setJotApi(window.jot)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Capture />
  </React.StrictMode>
)
