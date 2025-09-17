import { SimpleChatbot } from "@/components/simple/SimpleChatbot";

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 flex items-center justify-center">
      <div className="w-full max-w-4xl h-[600px]">
        <SimpleChatbot className="h-full" />
      </div>
    </div>
  );
}

export default App;
