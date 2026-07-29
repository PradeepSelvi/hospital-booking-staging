import { Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'

export default function DoctorLayout() {
  return (
    <div className="d-flex">
      <Sidebar role="DOCTOR" />
      <div className="main-content" style={{ padding: '32px 32px 48px', background: 'var(--gray-50)' }}>
        <Outlet />
      </div>
    </div>
  )
}
