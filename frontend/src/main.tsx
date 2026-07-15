import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import HomePage from './pages/HomePage'
import NotesPage from './pages/NotesPage'
import 'katex/dist/katex.min.css'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/jobs/:jobId/notes" element={<NotesPage />} />
            </Routes>
        </BrowserRouter>
    </StrictMode>
)