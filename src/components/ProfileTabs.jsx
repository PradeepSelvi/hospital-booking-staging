/**
 * Reusable tabbed navigation for profile pages.
 *
 * Props:
 * - tabs: string[] — tab labels
 * - activeTab: number — active tab index
 * - onChange: (index: number) => void — callback
 * - icons: string[] — optional bootstrap icon classes
 */
export default function ProfileTabs({ tabs = [], activeTab = 0, onChange, icons = [] }) {
  return (
    <div className="profile-tabs">
      {tabs.map((tab, i) => (
        <button
          key={tab}
          type="button"
          className={`profile-tab ${activeTab === i ? 'active' : ''}`}
          onClick={() => onChange(i)}
        >
          {icons[i] && <i className={`bi ${icons[i]}`} />}
          <span>{tab}</span>
        </button>
      ))}
    </div>
  )
}
