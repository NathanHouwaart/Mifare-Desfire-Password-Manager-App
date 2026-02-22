import { useState } from 'react';

export const MainPage = () => {
  const [greeting, setGreeting] = useState<string>('');
  const [sum, setSum] = useState<number | null>(null);

  const handleGreet = async () => {
    const result = await window.electron.greet('React User');
    setGreeting(result);
  };

  const handleAdd = async () => {
    const result = await window.electron.add(5, 7);
    setSum(result);
  };

  return (
    <div className="p-8 text-white">
      <h1 className="text-2xl font-bold mb-4">Electron C++ Template</h1>
      
      <div className="mb-6">
        <button 
          onClick={handleGreet}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded mr-4"
        >
          Test Greet (C++)
        </button>
        {greeting && <span className="ml-2">Result: {greeting}</span>}
      </div>

      <div>
        <button 
          onClick={handleAdd}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded mr-4"
        >
          Test Add 5 + 7 (C++)
        </button>
        {sum !== null && <span className="ml-2">Result: {sum}</span>}
      </div>
    </div>
  );
};
