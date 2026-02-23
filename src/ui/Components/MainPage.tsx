import { useState } from 'react';
import { DebugTerminal } from './DebugTerminal';

export const MainPage = () => {
  const [greeting, setGreeting] = useState<string>('');
  const [sum, setSum] = useState<number | null>(null);
  const [port, setPort] = useState<string>('COM3');
  const [connectResult, setConnectResult] = useState<string>('');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);

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
      setIsConnected(true);
    } catch (error: unknown) {
      setConnectResult('Error: ' + (error instanceof Error ? error.message : String(error)));
      setIsConnected(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setConnectResult('Disconnecting...');
      const result = await window.electron.disconnect();
      setConnectResult(result ? 'Disconnected successfully' : 'Failed to disconnect');
      setIsConnected(false);
    } catch (error: unknown) {
      setConnectResult('Error: ' + (error instanceof Error ? error.message : String(error)));
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">PN532 Connection</h2>
          <div className="flex items-center gap-2 text-sm">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-gray-500'}`} />
            <span className={isConnected ? 'text-green-400' : 'text-gray-500'}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        <div className="flex items-center mb-4">
          <label className="mr-2">COM Port:</label>
          <input
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            disabled={isConnected}
            className="bg-gray-800 text-white px-2 py-1 rounded border border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleConnect}
            disabled={isConnected}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded"
          >
            Connect
          </button>
          <button
            onClick={handleDisconnect}
            disabled={!isConnected}
            className="bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded"
          >
            Disconnect
          </button>
          <button
            onClick={() => setIsTerminalOpen((p) => !p)}
            className="ml-auto bg-[#2d2d2d] hover:bg-[#3c3c3c] border border-gray-600 text-gray-300 text-sm px-3 py-1 rounded"
          >
            {isTerminalOpen ? 'Hide' : 'Show'} Output
          </button>
        </div>
        {connectResult && (
          <div className="mt-4 p-2 bg-gray-800 rounded text-sm">{connectResult}</div>
        )}
      </div>

      <DebugTerminal isOpen={isTerminalOpen} onOpenChange={(v) => setIsTerminalOpen(v)} />
    </div>
  );
};
