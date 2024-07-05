package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

func connectAndSubscribe(walletPubKey string) (*websocket.Conn, error) {
	u := url.URL{
		Scheme:   "wss",
		Host:     "mainnet.helius-rpc.com",
		RawQuery: "api-key=49a67108-ceb9-4075-a89e-cd19aedd94b2",
	}
	log.Printf("Connecting to %s", u.String())

	// Use DefaultDialer from the gorilla/websocket package to initiate the WebSocket connection
	dialer := websocket.DefaultDialer
	c, resp, err := dialer.Dial(u.String(), nil)
	if err != nil {
		log.Printf("Dial error: %v", err)
		if resp != nil {
			log.Printf("HTTP Response Code: %d, Status: %s", resp.StatusCode, resp.Status)
		}
		return nil, err
	}
	defer func() {
		if resp != nil {
			resp.Body.Close()
		}
	}()

	fmt.Println("WebSocket connection established successfully")

	// Sending the subscription message
	subscribeMessage := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"logsSubscribe","params":[{"mentions":["%s"]},{"commitment":"finalized"}]}`, walletPubKey)
	err = c.WriteMessage(websocket.TextMessage, []byte(subscribeMessage))
	if err != nil {
		c.Close()
		log.Printf("Subscribe error: %v", err)
		return nil, err
	}

	return c, nil
}

func main() {
	walletPubKey := ""
	pingInterval := 25 * time.Second

	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, syscall.SIGINT, syscall.SIGTERM)

	for {
		c, err := connectAndSubscribe(walletPubKey)
		if err != nil {
			log.Println("Failed to connect:", err)
			time.Sleep(3 * time.Second)
			continue
		}

		done := make(chan struct{})
		go func() {
			ticker := time.NewTicker(pingInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := c.WriteMessage(websocket.PingMessage, []byte{}); err != nil {
						log.Println("ping:", err)
						c.Close()
						return
					}
				case <-done:
					return
				}
			}
		}()

		go func() {
			for {
				_, message, err := c.ReadMessage()
				if err != nil {
					log.Println("read:", err)
					c.Close()
					close(done)
					break
				}

				go func(msg []byte) {
					var messageData map[string]interface{}
					if err := json.Unmarshal(msg, &messageData); err != nil {
						log.Printf("Failed to unmarshal message: %v", err)
						return
					}

					// Handle the incoming WebSocket message here
				}(message)
			}
		}()

		select {
		case <-interrupt:
			log.Println("Interrupt received, shutting down...")
			c.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
			time.Sleep(1 * time.Second)
			return
		case <-done:
			log.Println("Connection closed, reconnecting...")
		}

		time.Sleep(3 * time.Second)
	}
}
