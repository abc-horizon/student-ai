import { Routes, Route } from 'react-router-dom'
import { ReviewProvider } from './context/ReviewContext.jsx'
import UploadPage from './pages/UploadPage.jsx'
import ProcessingPage from './pages/ProcessingPage.jsx'
import ReportPage from './pages/ReportPage.jsx'

function App() {
  return (
    <ReviewProvider>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/processing" element={<ProcessingPage />} />
        <Route path="/report" element={<ReportPage />} />
      </Routes>
    </ReviewProvider>
  )
}

export default App
