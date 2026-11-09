  function setupEventHandlers(messagesId, messageElementBuilder)
  {
    let socket = io();

    let clientNum = -1;
    let clientId;

    let oldWidth = -1;
    let oldHeight = -1;

    let form = document.getElementById('form');
    let input = document.getElementById('input');
    let messages = document.getElementById(messagesId);

    form.addEventListener('submit', (e) =>
    {
        e.preventDefault();

        ////---------------------------------------- Local Interaction Event Hanlders -------------------------------------////
        if (input.value) // defensive programming
        {
            // build a chat message and send it to socketServer (which sends to all clients)
            let messageObject = new Object();
            messageObject.name = CHAT;
            messageObject.msg  = input.value;
            messageObject.clientNum = clientNum;
            messageObject.id        = clientId;
            let messageString = JSON.stringify(messageObject);
            input.value = '';
            socket.emit(CHAT, messageString);
        }
        });

        window.onresize = (event) =>
        {
        if (clientNum < 0)
            return; // ignore spurious events before initialization
        
        let newWidth = window.innerWidth;
        let newHeight = window.innerHeight;

        // avoid sending the same message twice in a row!
        if ((newWidth != oldWidth) || (newHeight != oldHeight)) // should really be or but it's so verbose anyway :)
        // if (true)
        {
            // build a resize message and send it to socketServer (which sends to all clients)
            let messageObject = new Object();
            oldWidth = newWidth;
            oldHeight= newHeight;
            messageObject.name = "resize";
            messageObject.width = newWidth;
            messageObject.height = newHeight;
            messageObject.clientNum = clientNum;
            messageObject.id        = clientId;
            let messageString = JSON.stringify(messageObject);
            socket.emit(CHAT, messageString);
        }

        };
    ////---------------------------------------- WebSocket Event Hanlders -------------------------------------////
    socket.on(INIT, (which, thatId) =>
    {
      // display the client number in the upper right hand corner
      if (clientNum == -1)
      {
        clientNum = which;
        alert("Connected! " + which + " " + thatId);
        clientId = thatId;
        document.getElementById("client_num").textContent = "client " + which;
        document.title += " " + which;
      }
    });
    socket.on(CHAT, (msg) =>
    {
      // handle socket message
      // create list element with the message and append to list in the document
      //TODO add reall message handling code here
      let messageElement = messageElementBuilder(msg);
      messages.appendChild(messageElement);
      window.scrollTo(0, document.body.scrollHeight);
    });
  }
