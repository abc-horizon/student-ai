import { Routes, Route } from 'react-router-dom'
import { ReviewProvider } from './context/ReviewContext.jsx'
import { TeacherProvider, RequireTeacherAuth } from './context/TeacherContext.jsx'
import UploadPage from './pages/UploadPage.jsx'
import ProcessingPage from './pages/ProcessingPage.jsx'
import ReportPage from './pages/ReportPage.jsx'
import TeacherLoginPage from './pages/TeacherLoginPage.jsx'
import TeacherDashboardPage from './pages/TeacherDashboardPage.jsx'
import TeacherCourseRosterPage from './pages/TeacherCourseRosterPage.jsx'
import TeacherStudentReviewPage from './pages/TeacherStudentReviewPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

function App() {
  return (
    <ReviewProvider>
      <TeacherProvider>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/processing" element={<ProcessingPage />} />
          <Route path="/report" element={<ReportPage />} />

          <Route path="/teacher/login" element={<TeacherLoginPage />} />
          <Route
            path="/teacher"
            element={
              <RequireTeacherAuth>
                <TeacherDashboardPage />
              </RequireTeacherAuth>
            }
          />
          <Route
            path="/teacher/courses/:courseId"
            element={
              <RequireTeacherAuth>
                <TeacherCourseRosterPage />
              </RequireTeacherAuth>
            }
          />
          <Route
            path="/teacher/courses/:courseId/students/:studentId"
            element={
              <RequireTeacherAuth>
                <TeacherStudentReviewPage />
              </RequireTeacherAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireTeacherAuth>
                <SettingsPage />
              </RequireTeacherAuth>
            }
          />
        </Routes>
      </TeacherProvider>
    </ReviewProvider>
  )
}

export default App
