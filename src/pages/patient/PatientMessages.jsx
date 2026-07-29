import Navbar from '../../components/Navbar'
import Footer from '../../components/Footer'
import Messages from '../Messages'

export default function PatientMessages() {
  return (
    <>
      <Navbar />
      <div className="container" style={{ padding: '24px 16px 48px' }}>
        <Messages role="PATIENT" />
      </div>
      <Footer />
    </>
  )
}
