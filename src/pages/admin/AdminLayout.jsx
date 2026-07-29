import { Outlet } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'

export default function AdminLayout() {
  return (
    <div className="d-flex">
      <Sidebar role="ADMIN" />
      <div className="main-content" style={{ padding: '32px 32px 48px', background: 'var(--gray-50)' }}>
        <Outlet />
      </div>
    </div>
  )
}
