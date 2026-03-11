import Sidebar from './Sidebar'

interface LayoutAdminProps {
  children: React.ReactNode
  title: string
  actions?: React.ReactNode
}

export default function LayoutAdmin({ children, title, actions }: LayoutAdminProps) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>
        <div className="flex-1 p-8 overflow-auto">{children}</div>
      </main>
    </div>
  )
}
