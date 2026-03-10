// src/sockets/productViewer.js
module.exports = (io, socket) => {
  // Keep track of viewers per product in memory
  const viewers = {}; // { productId: Set of socketIds }

  socket.on('join-product', productId => {
    if (!viewers[productId]) viewers[productId] = new Set();
    viewers[productId].add(socket.id);

    socket.join(productId);

    io.to(productId).emit('viewer-count', {
      productId,
      viewers: viewers[productId].size,
    });
  });

  socket.on('leave-product', productId => {
    if (viewers[productId]) {
      viewers[productId].delete(socket.id);
      io.to(productId).emit('viewer-count', {
        productId,
        viewers: viewers[productId].size,
      });
    }
    socket.leave(productId);
  });

  socket.on('disconnect', () => {
    // Remove socket from all products it joined
    for (const [productId, socketsSet] of Object.entries(viewers)) {
      if (socketsSet.has(socket.id)) {
        socketsSet.delete(socket.id);
        io.to(productId).emit('viewer-count', {
          productId,
          viewers: socketsSet.size,
        });
      }
    }
  });
};
