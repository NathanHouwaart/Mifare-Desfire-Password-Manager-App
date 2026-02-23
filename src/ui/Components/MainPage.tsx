import { useState } from 'react';

export const MainPage = () => {
  const [greeting, setGreeting] = useState<string>('');
  const [sum, setSum] = useState<number | null>(null);
  const [port, setPort] = useState<string>('COM3');
  const [connectResult, setConnectResult] = useState<string>('');

  const handleGreet = async () => {
    const result = await window.electron.greet('React User');
    setGreeting(result);
  };

  const handleAdd = async () => {
    const result = await window.electron.add(5, 7);
    setSum(result);
  };

  const handleConnect = async () => {
    try {
      setConnectResult('Connecting...');
      const result = await window.electron.connect(port);
      setConnectResult(result);
    } catch (error: any) {
      setConnectResult('Error: ' + error.message);
    }
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

      <div className="mb-6">
        <button 
          onClick={handleAdd}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded mr-4"
        >
          Test Add 5 + 7 (C++)
        </button>
        {sum !== null && <span className="ml-2">Result: {sum}</span>}
      </div>

      <div className="mt-8 p-4 border border-gray-600 rounded">
        <h2 className="text-xl font-bold mb-4">PN532 Connection</h2>
        <div className="flex items-center mb-4">
          <label className="mr-2">COM Port:</label>
          <input 
            type="text" 
            value={port} 
            onChange={(e) => setPort(e.target.value)}
            className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600"
          />
        </div>
        <button 
          onClick={handleConnect}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded mr-4"
        >
          Connect to PN532
        </button>
        {connectResult && <div className="mt-4 p-2 bg-gray-800 rounded">{connectResult}</div>}
      </div>
    </div>
  );
};
