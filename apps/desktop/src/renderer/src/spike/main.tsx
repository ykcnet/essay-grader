import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SpikeApp from './SpikeApp'
import './spike.css'

const container = document.getElementById('root')
if (!container) throw new Error('找不到 #root 容器')

createRoot(container).render(
  <StrictMode>
    <SpikeApp />
  </StrictMode>
)
