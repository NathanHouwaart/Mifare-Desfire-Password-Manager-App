import './App.css'
import { MainPage } from './Components/MainPage';
import { Route, Routes } from 'react-router-dom';

function App() {
  return (
    <>
      <div className="flex">
        <main className="p-4 flex-1">
          <Routes>
            <Route path="/" element={<MainPage />} />
          </Routes>
        </main>
      </div>
    </>
  )
}

export default App
